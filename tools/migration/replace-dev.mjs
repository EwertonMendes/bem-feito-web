import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

/**
 * Controlled DEV-only replacement.
 *
 * Never touches Auth, owner permissions or production. All DEV operational
 * documents (including archival subcollections) are backed up persistently in
 * Firestore's restricted devMigrationBackups collection and read back BEFORE
 * they are deleted. Import/verification failures restore the prior data.
 *
 * Tests run in an isolated emulator after the replacement, not against DEV.
 */
const project = process.env.FIREBASE_PROJECT_ID;
if (project !== 'bem-feito-dev' || process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('A substituição é permitida apenas no Firestore DEV real.');
}
if (process.env.DEV_REPLACE_APPROVED !== 'confirmed-by-owner-comment') {
  throw new Error('Exige confirmação explícita do proprietário no workflow confiável.');
}
const srcText = await readFile('tools/migration/migration-data.json', 'utf8');
const sourceText = await readFile('tools/migration/legacy-raw.json', 'utf8');
const incoming = JSON.parse(srcText);
const digest = createHash('sha256').update(srcText).update(sourceText).digest('hex');
const migrationId = digest.slice(0, 24);
const collections = [
  'collections', 'fragrances', 'formats', 'formatPrices', 'units',
  'paymentMethods', 'expenseCategories', 'expenseTypes',
  'inputs', 'products', 'kits', 'additions', 'expenses', 'productions',
  'sales', 'payments', 'stockAdjustments', 'stockMovements', 'counters',
  'migrationRuns', 'migrationSources',
];
const operational = collections.filter(name => !['migrationRuns', 'migrationSources'].includes(name));
for (const name of operational) {
  assert.ok(Array.isArray(incoming[name]), 'Coleção não exportada: ' + name);
}
assert.equal(incoming.bankSnapshot?.balanceCents, 48169, 'Saldo bancário diferente da conciliação aprovada.');
assert.equal(incoming.bankSnapshot?.ownerFundedCents, 85311, 'Aporte diferente da conciliação aprovada.');
assert.equal(incoming.sales.length, 25, 'Contagem de vendas diferente da conciliação.');
assert.equal(incoming.payments.length, 24, 'Contagem de recebimentos diferente da conciliação.');
assert.equal(incoming.productions.length, 45, 'Contagem de produções diferente da conciliação.');
assert.equal(incoming.expenses.length, 16, 'Contagem de compras diferente da conciliação.');
const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 1024 * 1024 * 12, ...options });
  if (result.status !== 0) {
    const error = (result.stderr || result.stdout || '').slice(-2500);
    throw new Error(command + ' ' + args.join(' ') + ' falhou: ' + error);
  }
  return result.stdout;
};
run(process.execPath, ['tools/migration/validate-export.mjs']);
const app = initializeApp({ credential: applicationDefault(), projectId: project });
const db = getFirestore(app);
const head = db.collection('devMigrationBackups');
const previousImport = await db.collection('migrationRuns').doc(migrationId).get();
if (previousImport.exists) {
  throw new Error('Esta versão já foi importada anteriormente. Não limpar dados novamente.');
}
const backupId = 'pre-migration-' + new Date().toISOString().replace(/[:.]/g, '-') + '-' + migrationId.slice(0, 8);
const manifest = head.doc(backupId);
const backupItems = manifest.collection('documents');
const originals = [];
const visited = new Set();
async function gatherDocument(ref) {
  if (visited.has(ref.path)) return;
  visited.add(ref.path);
  const snapshot = await ref.get();
  if (snapshot.exists) originals.push({ path: ref.path, payload: snapshot.data() });
  for (const subcollection of await ref.listCollections()) {
    for (const subdoc of await subcollection.listDocuments()) await gatherDocument(subdoc);
  }
}
for (const name of collections) {
  for (const ref of await db.collection(name).listDocuments()) await gatherDocument(ref);
}
const bankRef = db.doc('system/bank-snapshot');
const priorBank = await bankRef.get();
if (priorBank.exists) originals.push({ path: bankRef.path, payload: priorBank.data() });
if (originals.length > 3500) throw new Error('Número inesperado de documentos DEV. Revisão manual obrigatória.');
const contentsHash = list => createHash('sha256').update(JSON.stringify(
  list.map(({ path, payload }) => ({ path, payload })).sort((a, b) => a.path.localeCompare(b.path))
)).digest('hex');
const originalHash = contentsHash(originals);
await manifest.create({
  project, migrationId, status: 'capturing', records: originals.length,
  digest: originalHash, createdAt: FieldValue.serverTimestamp(),
  sourceSpreadsheetId: JSON.parse(sourceText).spreadsheetId,
});
for (let start = 0; start < originals.length; start += 200) {
  const batch = db.batch();
  for (const item of originals.slice(start, start + 200)) {
    const id = createHash('sha256').update(item.path).digest('hex');
    batch.create(backupItems.doc(id), { path: item.path, payload: item.payload });
  }
  await batch.commit();
}
const saved = await backupItems.get();
const savedData = saved.docs.map(doc => doc.data());
if (saved.size !== originals.length || contentsHash(savedData) !== originalHash) {
  throw new Error('Backup DEV não passou na verificação independente. Nenhum registro operacional removido.');
}
await manifest.update({ status: 'verified', verifiedAt: FieldValue.serverTimestamp() });
console.log(JSON.stringify({
  backupId, project, recordsSaved: saved.size,
  incomingRecords: operational.reduce((sum, name) => sum + incoming[name].length, 0),
  status: 'Backup persistente verificado, antes de qualquer exclusão',
}));

// No deletion can start until the backup was independently read and verified.
async function eraseDestination() {
  for (const name of collections) await db.recursiveDelete(db.collection(name));
  if ((await bankRef.get()).exists) await bankRef.delete();
}
async function restore() {
  // Re-read the persistent backup, rather than trusting local ephemeral memory.
  const docs = (await backupItems.get()).docs.map(doc => doc.data());
  if (docs.length !== originals.length || contentsHash(docs) !== originalHash) {
    throw new Error('Backup restaurável inválido. Intervenção manual necessária: ' + backupId);
  }
  await eraseDestination();
  const rows = docs.sort((a, b) => a.path.split('/').length - b.path.split('/').length);
  for (let i = 0; i < rows.length; i += 200) {
    const batch = db.batch();
    for (const row of rows.slice(i, i + 200)) batch.set(db.doc(row.path), row.payload);
    await batch.commit();
  }
  await manifest.update({ status: 'restored', restoredAt: FieldValue.serverTimestamp() });
  console.log('Rollback DEV confirmado pelo backup ' + backupId);
}
let cleared = false;
try {
  await eraseDestination();
  cleared = true;
  console.log('Somente coleções operacionais DEV foram limpas; autenticação e usuários preservados.');
  run(process.execPath, ['tools/migration/import-firestore.mjs', '--commit'], {
    env: { ...process.env, MIGRATION_ACTOR: 'dev-snapshot-2026-10-09' },
  });
  run(process.execPath, ['tools/migration/verify-firestore.mjs', '--exact-counts']);
  await manifest.update({
    status: 'complete',
    replacedAt: FieldValue.serverTimestamp(),
    migratedRecords: operational.reduce((sum, name) => sum + incoming[name].length, 0),
  });
  console.log(JSON.stringify({ status: 'DEV_REPLACED_AND_VERIFIED', backupId, migrationId, project }));
} catch (error) {
  if (cleared) {
    console.error('Falha de migração. Iniciando restauração do DEV anterior.');
    try {
      await restore();
    } catch (rollbackError) {
      console.error('ROLLBACK FAILED: ' + rollbackError.message + ' | backup=' + backupId);
      throw new AggregateError([error, rollbackError], 'Importação e restauração falharam.');
    }
  }
  throw error;
}
