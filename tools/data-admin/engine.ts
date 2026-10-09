import { Timestamp } from 'firebase-admin/firestore';
import type { Firestore, DocumentSnapshot } from 'firebase-admin/firestore';
import { encode, decode } from './codec.ts';
import { hash, requestHash, invariant, assertScope, redact } from './schema.ts';
import type { Request, Payload } from './schema.ts';
import type { Archive } from './storage.ts';

export type Row = { path: string; version: string | null; before: any; after: any };
export type Plan = {
  schemaVersion: 1; requestHash: string; projectId: string; environment: string;
  operation: string; scope: string[]; rows: Row[]; dependencies: { path: string; version: string }[];
  sourceHash?: string;
};
export type Actor = { login: string; id: string; requestSha: string; trustedSha: string; runId: string; commentId: string; approvedPlan?: string };
// Firestore removed the 500-write transaction limit in March 2023. Keep our own
// conservative capacity and payload limits; server size/index/time limits still apply.
export const MAX_ATOMIC_DOCUMENTS = 2000;
export function assertPlanCapacity(rows: Row[]) {
  invariant(rows.length > 0 && rows.length <= MAX_ATOMIC_DOCUMENTS, 'Operation exceeds safe atomic capacity; no partial writes');
  invariant(Buffer.byteLength(JSON.stringify(rows), 'utf8') <= 4_000_000, 'Operation payload exceeds safe atomic size; no partial writes');
  invariant(new Set(rows.map(r => r.path)).size === rows.length, 'Duplicate plan path');
}
export const version = (snapshot: DocumentSnapshot) => snapshot.updateTime ? `${snapshot.updateTime.seconds}:${snapshot.updateTime.nanoseconds}` : null;
export function withoutAudit(payload: Payload | null): Payload | null {
  if (!payload) return null;
  return Object.fromEntries(Object.entries(payload).filter(([k]) => !['createdAt', 'updatedAt', 'createdBy', 'updatedBy'].includes(k)));
}
export function snapshotRow(snapshot: DocumentSnapshot): Row {
  const data = snapshot.exists ? snapshot.data()! : null;
  return { path: snapshot.ref.path, version: version(snapshot), before: encode(data), after: encode(data) };
}
function assertExpected(data: Payload | null, expected: Payload | null) {
  if (expected === null) { invariant(data === null, 'Create destination already exists'); return; }
  invariant(data, 'Expected document missing');
  for (const [key, value] of Object.entries(expected)) invariant(hash(data[key]) === hash(value), 'Field precondition differs');
}
export async function prepare(request: Request, db: Firestore, archive: Archive): Promise<Plan> {
  invariant(request.operation !== 'migrate', 'Use registered migration planner');
  let rows: Row[];
  let scope: string[];
  if (request.operation === 'restore') {
    const backup = await archive.get('backups', request.backup!);
    invariant(backup.schemaVersion === 1 && backup.projectId === request.projectId && backup.environment === request.environment, 'Backup environment differs');
    invariant(Array.isArray(backup.rows), 'Invalid backup scope');
    assertPlanCapacity(backup.rows);
    scope = backup.scope;
    assertScope(request, scope);
    for (const row of backup.rows) invariant(validBackupPath(row.path), 'Protected path in backup');
    for (const collection of scope.filter((p: string) => !p.includes('/'))) {
      const roots = await db.collection(collection).select().get();
      invariant(roots.docs.every(d => backup.rows.some((r: Row) => r.path === d.ref.path)), 'Backup scope has newer documents; review recovery before restoring');
    }
    const current = await db.getAll(...backup.rows.map((r: any) => db.doc(r.path)));
    rows = current.map((s, i) => ({ ...snapshotRow(s), after: backup.rows[i].before }));
  } else {
    const targets = request.targets ?? request.changes!;
    scope = targets.map(t => `${t.collection}/${t.id}`);
    const current = await db.getAll(...scope.map(p => db.doc(p)));
    rows = current.map(snapshotRow);
    if (request.changes) {
      for (const [i, change] of request.changes.entries()) {
        const before = current[i].exists ? current[i].data()! : null;
        assertExpected(before, change.expected);
        let after: Payload | null = change.action === 'delete' ? null : { ...(before ?? {}), ...change.values };
        if (change.collection === 'fragrances' && before) invariant(after?.collectionId === before.collectionId, 'Changing fragrance ownership needs a registered domain migration');
        if (change.collection === 'formatPrices' && before) invariant(after?.collectionId === before.collectionId && after?.formatId === before.formatId, 'Changing price relationships needs a registered domain migration');
        if (change.collection === 'inputs' && after) {
          const basis = Math.max(0, Number(before?.costBasisQuantity ?? before?.stock ?? 0));
          invariant(Number.isFinite(basis) && basis <= 1_000_000, 'Invalid input cost basis');
          after.costBasisQuantity = basis;
          after.costBasisValueCents = Math.round(basis * Number(after.averageUnitCostCents));
          invariant(Number.isSafeInteger(after.costBasisValueCents) && Number(after.costBasisValueCents) <= 1_000_000_000, 'Input cost basis exceeds domain limit');
        }
        rows[i].after = encode(after);
      }
    }
  }
  if (request.operation === 'delete') assertScope(request, scope);
  const dependencies: Plan['dependencies'] = [];
  // All new relationships are read again inside the write transaction.
  for (const row of rows.filter(() => !['read', 'inspect', 'verify', 'backup'].includes(request.operation))) {
    const after = decode(row.after, db);
    if (request.operation === 'create' && row.path.startsWith('formatPrices/')) {
      const duplicates = await db.collection('formatPrices').where('collectionId', '==', after.collectionId).where('formatId', '==', after.formatId).get();
      invariant(duplicates.empty, 'Referenced price pair already exists');
    }
    for (const [key, collection] of [['collectionId', 'collections'], ['formatId', 'formats']] as const) {
      if (after?.[key] && ['fragrances', 'formatPrices'].includes(row.path.split('/')[0])) {
        const path = `${collection}/${after[key]}`;
        const local = rows.find(r => r.path === path);
        if (local) invariant(decode(local.after, db) !== null && (request.operation === 'restore' || decode(local.after, db)?.active === true), 'Inactive relationship in operation');
        else {
          const ref = await db.doc(path).get();
          invariant(ref.exists && (request.operation === 'restore' || ref.data()?.active === true), 'Referenced catalog missing or inactive');
          dependencies.push({ path, version: version(ref)! });
        }
      }
    }
  }
  return { schemaVersion: 1, requestHash: requestHash(request), projectId: request.projectId, environment: request.environment, operation: request.operation, scope, rows, dependencies };
}
export function validBackupPath(path: string) {
  return /^(collections|fragrances|formats|formatPrices|units|paymentMethods|expenseCategories|expenseTypes|inputs|products|kits|additions|expenses|productions|sales|payments|stockAdjustments|stockMovements|counters|migrationRuns|migrationSources|dataAdminSmoke)\/[A-Za-z0-9][A-Za-z0-9_-]{0,99}(\/sheets\/[A-Za-zÀ-ÿ0-9 _-]{1,100})?$/.test(path) || path === 'system/bank-snapshot';
}
export function report(plan: Plan, db: Firestore) {
  return { planHash: hash(plan), requestHash: plan.requestHash, projectId: plan.projectId, operation: plan.operation, scope: plan.scope, affectedDocuments: plan.rows.map(row => ({ path: row.path, exists: row.version !== null, before: redact(withoutAudit(decode(row.before, db))), after: redact(withoutAudit(decode(row.after, db))) })), ...(plan.sourceHash ? { sourceHash: plan.sourceHash } : {}) };
}
async function verifyResult(plan: Plan, db: Firestore) {
  const current = await db.getAll(...plan.rows.map(row => db.doc(row.path)));
  for (const [i, row] of plan.rows.entries()) {
    const actual = current[i].exists ? current[i].data()! : null;
    const expected = decode(row.after, db);
    invariant(hash(encode(withoutAudit(actual))) === hash(encode(withoutAudit(expected))), 'Post-commit verification differs; preserve backup and inspect receipt before recovery');
  }
  if (plan.operation === 'migrate') {
    for (const collection of plan.scope.filter(p => !p.includes('/'))) {
      const roots = await db.collection(collection).select().get();
      const expected = plan.rows.filter(r => r.path.startsWith(collection + '/') && r.path.split('/').length === 2 && decode(r.after, db) !== null).map(r => r.path).sort();
      invariant(hash(roots.docs.map(d => d.ref.path).sort()) === hash(expected), 'Post-commit migration contains unexpected/missing documents; inspect protected backup');
    }
  }
}
export async function apply(request: Request, plan: Plan, db: Firestore, archive: Archive, actor: Actor) {
  invariant(actor.approvedPlan === hash(plan), 'Explicit approved plan hash required');
  invariant(plan.requestHash === requestHash(request) && plan.projectId === request.projectId && plan.environment === request.environment, 'Plan/request mismatch');
  invariant(!['read', 'inspect', 'verify'].includes(request.operation), 'Read operations cannot apply');
  assertPlanCapacity(plan.rows);
  const receiptRef = db.doc(`dataAdminOperations/${request.id}`);
  const previous = await receiptRef.get();
  if (previous.exists) {
    invariant(previous.data()?.requestHash === plan.requestHash, 'Operation ID already belongs to another request');
    invariant(previous.data()?.status === 'complete', 'Operation needs recovery review');
    await verifyResult(plan, db);
    await archive.put('audit', { schemaVersion: 1, event: 'replay', actor, receipt: previous.data() });
    return { status: 'already-complete', backup: previous.data()?.backup, documents: previous.data()?.documents };
  }
  const backup = await archive.put('backups', { schemaVersion: 1, projectId: request.projectId, environment: request.environment, operationId: request.id, planHash: hash(plan), requestHash: plan.requestHash, scope: plan.scope, rows: plan.rows });
  // Independent download and checksum verification completed by Archive.put, before any DB write.
  await archive.put('audit', { schemaVersion: 1, event: 'intent', at: new Date().toISOString(), actor, operationId: request.id, ...report(plan, db), backup });
  const now = Timestamp.now();
  const summary = { requestHash: plan.requestHash, planHash: hash(plan), projectId: request.projectId, environment: request.environment, actor, operation: request.operation, documents: plan.rows.map(r => r.path), backup, status: 'complete', at: now.toDate().toISOString(), validation: 'schema-domain-preconditions-and-archive-verified' };
  const result = await db.runTransaction(async tx => {
    const old = await tx.get(receiptRef);
    if (old.exists) {
      invariant(old.data()?.requestHash === plan.requestHash && old.data()?.status === 'complete', 'Conflicting operation ID');
      return 'already-complete';
    }
    const refs = plan.rows.map(row => db.doc(row.path));
    const current = await tx.getAll(...refs);
    for (const [i, row] of plan.rows.entries()) invariant(version(current[i]) === row.version, 'Concurrent write: rebuild and approve a new preview');
    for (const dependency of plan.dependencies) invariant(version(await tx.get(db.doc(dependency.path))) === dependency.version, 'Concurrent relationship change');
    for (const row of plan.rows.filter(r => request.operation === 'create' && r.path.startsWith('formatPrices/') && r.version === null)) {
      const price = decode(row.after, db);
      if (price) {
        const duplicates = await tx.get(db.collection('formatPrices').where('collectionId', '==', price.collectionId).where('formatId', '==', price.formatId));
        invariant(duplicates.empty, 'Referenced price pair already exists');
      }
    }
    if (request.operation === 'migrate') {
      // Query all roots in-transaction so added/removed records cannot escape the exact scope.
      for (const collection of plan.scope.filter(p => !p.includes('/'))) {
        const currentRoots = await tx.get(db.collection(collection));
        const expectedRoots = plan.rows.filter(r => r.version !== null && r.path.startsWith(collection + '/') && r.path.split('/').length === 2).map(r => r.path).sort();
        invariant(hash(currentRoots.docs.map(d => d.ref.path).sort()) === hash(expectedRoots), 'Migration destination changed after preview');
      }
    }
    if (request.operation !== 'backup') {
      for (const [i, row] of plan.rows.entries()) {
        const after = decode(row.after, db);
        if (after === null) { if (current[i].exists) tx.delete(refs[i]); }
        else if (request.operation === 'restore') tx.set(refs[i], after);
        else tx.set(refs[i], { ...after, ...(current[i].exists ? {} : { createdAt: now, createdBy: `data-admin:${actor.id}` }), updatedAt: now, updatedBy: `data-admin:${actor.id}` });
      }
      tx.set(db.doc('system/data-revisions'), Object.fromEntries(['catalog', 'references', 'settings', 'sales', 'expenses', 'payments', 'finance', 'production', 'inventory'].map(domain => [domain, { source: `data-admin:${request.id}`, at: now }])), { merge: true });
    }
    tx.create(receiptRef, summary);
    return 'complete';
  });
  // A network failure after commit never triggers blind deletion/rollback. The atomic receipt is authoritative.
  await verifyResult(plan, db);
  await archive.put('audit', { schemaVersion: 1, event: 'verified', ...summary, verifiedAt: new Date().toISOString() });
  return { status: result, backup, documents: summary.documents, validation: 'readback-verified' };
}
