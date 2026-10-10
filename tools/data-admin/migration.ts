import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import type { Firestore, DocumentReference } from 'firebase-admin/firestore';
import { encode } from './codec.ts';
import { snapshotRow, assertPlanCapacity, MAX_ATOMIC_DOCUMENTS, validBackupPath } from './engine.ts';
import type { Plan, Row } from './engine.ts';
import { MIGRATION_COLLECTIONS, assertScope, hash, invariant, identifier, requestHash } from './schema.ts';
import type { Request } from './schema.ts';

export function runRegisteredScript(script: string, args: string[] = [], extraEnv: Record<string, string> = {}) {
  // Callers are trusted modules, never request-supplied paths, arguments, shell or code.
  const result = spawnSync(process.execPath, [script, ...args], { shell: false, encoding: 'utf8', maxBuffer: 12_000_000, timeout: 180_000, env: { ...process.env, ...extraEnv } });
  invariant(result.status === 0, `Registered migration stage failed: ${script}; private payload suppressed`);
}
function stableSource(value: any): any {
  if (Array.isArray(value)) return value.map(stableSource);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([k]) => k !== 'exportedAt').map(([k, v]) => [k, stableSource(v)]));
  return value;
}
export async function prepareMigration(request: Request, db: Firestore, env: any): Promise<Plan> {
  invariant(request.environment === 'dev' && request.projectId === 'bem-feito-dev', 'DEV-only migration');
  const deployment = await fetch('https://bem-feito-dev.web.app/deployment.json', { cache: 'no-store' });
  invariant(deployment.ok && (await deployment.json() as any).commit === request.deploymentSha, 'Exact application commit must already be deployed in DEV');
  runRegisteredScript('tools/migration/fetch-sheets.mjs', [], { MIGRATION_SNAPSHOT_ID: env.snapshotId });
  runRegisteredScript('tools/migration/normalize-legacy.mjs');
  runRegisteredScript('tools/migration/reconcile-legacy.mjs');
  runRegisteredScript('tools/migration/validate-export.mjs');
  const raw = JSON.parse(await readFile('tools/migration/legacy-raw.json', 'utf8'));
  const data = stableSource(JSON.parse(await readFile('tools/migration/migration-data.json', 'utf8')));
  invariant(raw.spreadsheetId === env.snapshotId && data.source?.spreadsheetId === env.snapshotId, 'Snapshot source differs');
  invariant(data.bankSnapshot?.balanceCents === 57944 && data.bankSnapshot?.ownerFundedCents === 73641 && data.bankSnapshot?.reimbursementDueCents === 0 && data.bankSnapshot?.businessDate === '2026-10-09', 'Approved bank reconciliation differs');
  for (const [name, total] of Object.entries({ sales: 25, payments: 25, productions: 47, expenses: 16 })) invariant(data[name]?.length === total, 'Approved source counts differ');
  for (const [id, state] of [['V00024', 'delivered'], ['V00025', 'ready']]) invariant(data.sales.find((sale: any) => sale.id === id)?.fulfillmentStatus === state, 'Order reconciliation differs');
  invariant(data.kits.length === 20 && data.kits.every((kit: any) => kit.active === false), 'All historical kits must be inactive');
  const oldKitFormat = data.formats.find((format: any) => format.name === 'Kit Mini');
  invariant(oldKitFormat && data.products.every((p: any) => p.formatId !== oldKitFormat.id || p.active === false), 'Legacy Kit Mini products must be inactive');
  const katiaPayments = data.payments.filter((p: any) => p.saleId === 'V00024' && p.status === 'active');
  const pix = data.paymentMethods.find((method: any) => method.name.toLocaleLowerCase('pt-BR') === 'pix');
  invariant(katiaPayments.length === 2 && !!pix && katiaPayments.every((p: any) => p.amountReceivedCents === 9750 && p.methodId === pix.id), 'Katia must have exactly two R$97.50 Pix payments');
  const katia = data.sales.find((sale: any) => sale.id === 'V00024');
  invariant(katia?.totalCents === 19500 && katia?.receivedCents === 19500 && katia?.balanceCents === 0, 'Katia settlement differs');
  for (const [id, amount] of [['M000005', 2200], ['M000006', 1680], ['M000007', 7790]] as const) {
    const purchase = data.expenses.find((item: any) => item.id === id);
    invariant(purchase?.amountCents === amount && purchase?.fundingSource === 'business', 'Shopee funding reconciliation differs: ' + id);
  }
  for (const [id, quantity] of [['BASE-BRA', 3.144], ['BASE-TRA', 0.085], ['INS-020', 98], ['INS-024', 24]] as const) {
    const input = data.inputs.find((item: any) => item.id === id);
    invariant(input?.trackingMode === 'exact' && Math.abs(input.stock - quantity) < 0.00001, 'Physical inventory differs: ' + id);
  }
  invariant(data.inputs.find((item: any) => item.id === 'LAU-27')?.trackingMode === 'untracked', 'Lauril must not require measurement');
  const sourceHash = hash({ data, raw: stableSource(raw) });
  const runId = sourceHash.slice(0, 24);
  invariant(!(await db.doc(`migrationRuns/${runId}`).get()).exists, 'Source version already migrated; use receipt verification');
  const scope = [...MIGRATION_COLLECTIONS, 'system/bank-snapshot'];
  assertScope(request, scope);
  const old = new Map<string, Row>();
  const visited = new Set<string>();
  async function gather(ref: DocumentReference) {
    if (visited.has(ref.path)) return; visited.add(ref.path);
    invariant(visited.size <= MAX_ATOMIC_DOCUMENTS, 'Current DEV state exceeds safe atomic replacement capacity');
    invariant(validBackupPath(ref.path), 'Protected or unregistered descendant in migration scope');
    const current = await ref.get(); if (current.exists) old.set(ref.path, snapshotRow(current));
    for (const sub of await ref.listCollections()) for (const doc of await sub.listDocuments()) await gather(doc);
  }
  // Bounded parallel reads include every descendant; transaction versions/root queries still
  // reject any changed destination at apply. Never skip an unknown descendant to save time.
  for (const collection of MIGRATION_COLLECTIONS) {
    const roots = await db.collection(collection).listDocuments();
    for (let offset = 0; offset < roots.length; offset += 15) await Promise.all(roots.slice(offset, offset + 15).map(gather));
  }
  await gather(db.doc('system/bank-snapshot'));
  const desired = new Map<string, any>();
  for (const collection of MIGRATION_COLLECTIONS.filter(c => !['migrationRuns', 'migrationSources'].includes(c))) {
    invariant(Array.isArray(data[collection]), 'Missing migration collection');
    for (const item of data[collection]) {
      identifier(item.id); const { id, ...payload } = item;
      desired.set(`${collection}/${id}`, payload);
    }
  }
  const counts = Object.fromEntries(MIGRATION_COLLECTIONS.filter(c => Array.isArray(data[c])).map(c => [c, data[c].length]));
  desired.set(`migrationRuns/${runId}`, { schemaVersion: 1, digest: sourceHash, source: data.source, counts, status: 'complete', operationId: request.id });
  desired.set(`migrationSources/${runId}`, { schemaVersion: 1, digest: sourceHash, spreadsheetId: env.snapshotId });
  desired.set('system/bank-snapshot', { ...data.bankSnapshot, migrationRunId: runId });
  const paths = [...new Set([...old.keys(), ...desired.keys()])].sort();
  invariant(paths.length <= MAX_ATOMIC_DOCUMENTS, 'Combined old/new DEV state exceeds atomic replacement capacity; no deletion is permitted');
  const missing = paths.filter(p => !old.has(p));
  if (missing.length) for (const snapshot of await db.getAll(...missing.map(p => db.doc(p)))) old.set(snapshot.ref.path, snapshotRow(snapshot));
  const rows = paths.map(path => ({ ...old.get(path)!, after: encode(desired.get(path) ?? null) }));
  assertPlanCapacity(rows);
  return { schemaVersion: 1, requestHash: requestHash(request), projectId: request.projectId, environment: 'dev', operation: 'migrate', scope, rows, dependencies: [], sourceHash };
}
