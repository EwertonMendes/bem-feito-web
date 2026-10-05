import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Firestore, FieldValue } from 'firebase-admin/firestore';
import { firebaseCliAuth } from '../admin/firebase-cli-credential.mjs';

const runId = process.argv[2];
assert.match(runId ?? '', /^[a-f0-9]{24}$/);
const aliases = JSON.parse(await readFile('.firebaserc', 'utf8'));
assert.equal(process.env.FIREBASE_PROJECT_ID, aliases.projects.dev);
const backup = JSON.parse(await readFile('tools/migration/.private/' + runId + '-before.json', 'utf8'));
assert.equal(backup.projectId, aliases.projects.dev);
assert.equal(backup.runId, runId);
const migrated = JSON.parse(await readFile('tools/migration/migration-data.json', 'utf8'));
const db = new Firestore({ projectId: aliases.projects.dev, auth: firebaseCliAuth() });
const sourceRef = db.collection('migrationSources').doc(runId);
assert.equal((await db.collection('migrationRuns').doc(runId).get()).data()?.status, 'complete');
const batch = db.batch();
const archivedRefs = [];
let archived = 0;
const stable = ({ active, updatedAt, updatedBy, ...rest }) => JSON.stringify(rest);
for (const [name, records] of Object.entries(backup.existing)) for (const record of records) {
  if (!((record.code ?? '').startsWith('DEV-TESTE-') || (record.name ?? '').startsWith('DEV —'))) continue;
  assert.ok(!migrated[name].some((item) => item.id === record.id), 'Nunca arquivar um ID da migração real');
  const { id, ...before } = record;
  const ref = db.collection(name).doc(id);
  const snapshot = await ref.get();
  if (!snapshot.exists) continue;
  const current = snapshot.data();
  assert.equal(current.active, false, 'Cadastro de teste deve estar inativo');
  assert.equal(stable(current), stable(before), 'Cadastro alterado depois do checkpoint; interrompendo');
  const archiveRef = sourceRef.collection('devTestFixtures').doc(name + '__' + id);
  batch.create(archiveRef, {
    collectionName: name, documentId: id, payload: current, archivedAt: FieldValue.serverTimestamp(),
    reason: 'Cadastro descartável criado na validação da configuração DEV. Preservado para recuperação.',
  });
  batch.delete(ref, { lastUpdateTime: snapshot.updateTime });
  archivedRefs.push({ ref, archiveRef });
  archived++;
}
assert.ok(archived <= 20, 'Quantidade inesperada de cadastros de teste');
console.log(JSON.stringify({ projectId: aliases.projects.dev, runId, disposableFixtures: archived, mode: process.argv.includes('--commit') ? 'commit' : 'dry-run' }));
if (process.argv.includes('--commit') && archived) {
  await batch.commit();
  for (const { ref, archiveRef } of archivedRefs) {
    const [original, archive] = await Promise.all([ref.get(), archiveRef.get()]);
    assert.equal(original.exists, false);
    assert.equal(archive.exists, true);
    assert.equal(archive.data().documentId, ref.id);
  }
  console.log(JSON.stringify({ archivedAndVerified: archived }));
}
