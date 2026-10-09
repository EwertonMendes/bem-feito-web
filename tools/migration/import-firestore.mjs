import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { FieldValue, Firestore, getFirestore } from 'firebase-admin/firestore';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { firebaseCliAuth } from '../admin/firebase-cli-credential.mjs';

const args = process.argv.slice(2);
const dataPath = resolve(args.find((arg) => !arg.startsWith('--')) ?? 'tools/migration/migration-data.json');
const projectId = process.env.FIREBASE_PROJECT_ID;
const aliases = JSON.parse(await readFile('.firebaserc', 'utf8'));
if (!projectId || projectId !== aliases.projects.dev) throw new Error('Importação permitida somente no alias DEV real.');
if (process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Remova FIRESTORE_EMULATOR_HOST para a migração real DEV.');
const validation = spawnSync(process.execPath, ['tools/migration/validate-export.mjs', dataPath], { encoding: 'utf8' });
if (validation.status !== 0) throw new Error('Validação falhou; nenhuma gravação. Execute migration:validate para revisar.');
const dataText = await readFile(dataPath, 'utf8');
const data = JSON.parse(dataText);
const rawText = await readFile(resolve('tools/migration/legacy-raw.json'), 'utf8');
const raw = JSON.parse(rawText);
if (!raw.spreadsheetId || raw.spreadsheetId !== data.source?.spreadsheetId) throw new Error('Fonte original ausente ou divergente.');
const digest = createHash('sha256').update(dataText).update(rawText).digest('hex');
const runId = digest.slice(0, 24);
const actor = process.env.MIGRATION_ACTOR ?? 'legacy-migration';
const collections = ['collections', 'fragrances', 'formats', 'formatPrices', 'units', 'paymentMethods', 'expenseCategories',
  'expenseTypes', 'inputs', 'products', 'kits', 'additions', 'expenses', 'productions', 'sales', 'payments',
  'stockAdjustments', 'stockMovements', 'counters'];
const counts = Object.fromEntries(collections.map((name) => [name, data[name].length]));
if (!data.bankSnapshot || !Number.isSafeInteger(data.bankSnapshot.balanceCents) || !Number.isSafeInteger(data.bankSnapshot.ownerFundedCents)) throw new Error('Snapshot bancário não está reconciliado.');
const db = args.includes('--firebase-cli')
  ? new Firestore({ projectId, auth: firebaseCliAuth() })
  : getFirestore(initializeApp({ credential: applicationDefault(), projectId }));
const runRef = db.collection('migrationRuns').doc(runId);
if ((await runRef.get()).exists) {
  console.log('Esta migração já foi concluída; nenhuma gravação repetida.');
  process.exit(0);
}
const existing = {};
for (const name of collections) {
  const snapshot = await db.collection(name).get();
  existing[name] = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
  const incomingIds = new Set(data[name].map((item) => item.id));
  if (existing[name].some((item) => incomingIds.has(item.id))) throw new Error('Conflito em ' + name + ': registros existentes não serão sobrescritos.');
}
const bankRef = db.doc('system/bank-snapshot');
if ((await bankRef.get()).exists) throw new Error('Saldo bancário DEV já existe: recuse sobrescrita sem conciliação explícita.');
const batch = db.batch();
let writes = 0;
for (const name of collections) for (const record of data[name]) {
  const { id, ...payload } = record;
  batch.create(db.collection(name).doc(id), { ...payload, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), createdBy: actor, updatedBy: actor });
  writes++;
}
const sourceRef = db.collection('migrationSources').doc(runId);
batch.create(sourceRef, { spreadsheetId: raw.spreadsheetId, spreadsheetName: raw.spreadsheetName, exportedAt: raw.exportedAt, digest, schemaVersion: raw.schemaVersion, sourceMetadataJson: JSON.stringify(raw.sourceMetadata ?? {}), formulaAuditJson: JSON.stringify(raw.formulaAudit ?? {}) });
writes++;
// Full immutable source remains in the private Google Drive snapshot. Only its checksum is stored in Firestore.
// This keeps the operational migration within one atomic Firestore batch and avoids duplicating personal data.
batch.create(bankRef, { ...data.bankSnapshot, migrationRunId: runId,
  createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
writes++;
if (args.includes('--deactivate-dev-tests')) for (const name of collections) for (const record of existing[name]) {
  if (record.active === true && ((record.code ?? '').startsWith('DEV-TESTE-') || (record.name ?? '').startsWith('DEV —'))) {
    batch.update(db.collection(name).doc(record.id), { active: false, updatedAt: FieldValue.serverTimestamp(), updatedBy: actor });
    writes++;
  }
}
batch.create(runRef, { source: data.source, schemaVersion: data.schemaVersion, digest, importedAt: FieldValue.serverTimestamp(), actor, counts, writes, status: 'complete' });
writes++;
if (writes > 490 || Buffer.byteLength(dataText) + Buffer.byteLength(rawText) > 8000000) throw new Error('Migração excede o limite do batch atômico; nenhuma gravação parcial.');
console.log(JSON.stringify({ projectId, runId, counts, existingCounts: Object.fromEntries(collections.map(name => [name, existing[name].length])), atomicWrites: writes, sourceArchive: 'private Google Drive snapshot', mode: args.includes('--commit') ? 'commit' : 'dry-run' }, null, 2));
if (!args.includes('--commit')) { console.log('Prévia concluída. Nenhum documento gravado.'); process.exit(0); }
const backupDir = resolve('tools/migration/.private');
await mkdir(backupDir, { recursive: true });
await writeFile(resolve(backupDir, runId + '-before.json'), JSON.stringify({ projectId, runId, existing }, null, 2));
// Source, counters, records and completion marker commit together. create() prevents overwrite races.
await batch.commit();
await writeFile(resolve(backupDir, runId + '-receipt.json'), JSON.stringify({ projectId, runId, digest, counts, writes }, null, 2));
console.log('Importação atômica concluída no DEV: ' + projectId);
