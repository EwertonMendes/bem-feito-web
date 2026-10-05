import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Firestore } from 'firebase-admin/firestore';
import { firebaseCliAuth } from '../admin/firebase-cli-credential.mjs';

const projectId = process.env.FIREBASE_PROJECT_ID;
const aliases = JSON.parse(await readFile('.firebaserc', 'utf8'));
assert.equal(projectId, aliases.projects.dev, 'Verificação exclusiva DEV');
const dataText = await readFile('tools/migration/migration-data.json', 'utf8');
const rawText = await readFile('tools/migration/legacy-raw.json', 'utf8');
const expected = JSON.parse(dataText);
const raw = JSON.parse(rawText);
const digest = createHash('sha256').update(dataText).update(rawText).digest('hex');
const runId = digest.slice(0, 24);
const db = new Firestore({ projectId, auth: firebaseCliAuth() });
const run = await db.collection('migrationRuns').doc(runId).get();
assert.equal(run.data()?.status, 'complete', 'Migração não concluída');
assert.equal(run.data()?.digest, digest);
const readback = { schemaVersion: expected.schemaVersion, source: expected.source };
let verified = 0;
for (const [name, records] of Object.entries(expected)) {
  if (!Array.isArray(records)) continue;
  const snapshot = await db.collection(name).get();
  if (process.argv.includes('--exact-counts')) {
    assert.equal(snapshot.size, records.length, 'Contagem divergente em ' + name);
  }
  const index = new Map(snapshot.docs.map((item) => [item.id, item.data()]));
  readback[name] = [];
  for (const record of records) {
    const { id, ...payload } = record;
    const actual = index.get(id);
    assert.ok(actual, 'Registro ausente em ' + name);
    const { createdAt, updatedAt, createdBy, updatedBy, ...fields } = actual;
    assert.deepEqual(fields, payload, 'Payload divergente em ' + name);
    assert.ok(createdAt?.toDate && updatedAt?.toDate, 'Auditoria ausente em ' + name);
    assert.equal(createdBy, run.data().actor);
    readback[name].push({ id, ...fields });
    verified++;
  }
}
const sourceRef = db.collection('migrationSources').doc(runId);
assert.equal((await sourceRef.get()).data()?.digest, digest);
for (const [name, rows] of Object.entries({ ...raw.sheets, ...raw.views })) {
  const source = await sourceRef.collection('sheets').doc(name).get();
  assert.deepEqual(JSON.parse(source.data()?.rowsJson ?? 'null'), rows, 'Fonte divergente em ' + name);
}
await mkdir('tools/migration/.private', { recursive: true });
await writeFile('tools/migration/.private/' + runId + '-readback.json', JSON.stringify(readback, null, 2));
console.log(JSON.stringify({ projectId, runId, verifiedRecords: verified, sourceSheets: Object.keys(raw.sheets).length + Object.keys(raw.views ?? {}).length, result: 'Conteúdo e auditoria conferem integralmente.' }, null, 2));
