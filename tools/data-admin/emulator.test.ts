import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, Timestamp, GeoPoint } from 'firebase-admin/firestore';
import { encode, decode } from './codec.ts';
import { hash, validateRequest } from './schema.ts';
import { prepare, apply, snapshotRow, assertPlanCapacity } from './engine.ts';
import { prepareDirect, validateDirectRequest } from './direct-gateway.ts';
import type { Archive } from './storage.ts';
import { FirestoreArchive } from './storage.ts';

assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8080', 'Destructive tests require an isolated emulator');
const app = initializeApp({ projectId: 'demo-bem-feito' }, 'data-admin-tests');
const db = getFirestore(app);
const archiveApp = initializeApp({ projectId: 'demo-bem-feito-archive' }, 'archive-tests');
const archiveDb = getFirestore(archiveApp);
class MemoryArchive implements Archive {
  objects = new Map<string, any>(); fail = false;
  async put(prefix: string, value: any) { if (this.fail) throw new Error('Simulated archive failure'); const id = hash(value); this.objects.set(`${prefix}/${id}`, structuredClone(value)); assert.equal(hash(await this.get(prefix as any, id)), id); return id; }
  async get(prefix: string, id: string) { const value = this.objects.get(`${prefix}/${id}`); assert.ok(value); assert.equal(hash(value), id); return structuredClone(value); }
}
let archive: MemoryArchive;
const actor = { login: 'tester', id: '123', requestSha: 'a'.repeat(40), trustedSha: 'b'.repeat(40), runId: '1', commentId: '1' };
const request = (id: string, operation = 'update') => validateRequest({ schemaVersion: 1, id, environment: 'dev', projectId: 'bem-feito-dev', operation, changes: [{ collection: 'dataAdminSmoke', id: 'smoke-test', action: operation, expected: { value: 10 }, ...(operation === 'delete' ? {} : { values: { value: 20 } }) }], ...(operation === 'delete' ? { destructive: { projectId: 'bem-feito-dev', paths: ['dataAdminSmoke/smoke-test'] } } : {}) });
before(async () => { await db.doc('dataAdminSmoke/smoke-test').set({ value: 10 }); });
beforeEach(async () => { archive = new MemoryArchive(); await db.doc('dataAdminSmoke/smoke-test').set({ value: 10 }); });
after(async () => {
  await db.recursiveDelete(db.collection('dataAdminOperations'));
  await db.doc('dataAdminSmoke/smoke-test').delete();
  await db.doc('system/data-revisions').delete();
  await db.doc('inputs/admin-test-input').delete();
  await db.recursiveDelete(db.collection('dataAdminSmoke'));
  await db.doc('collections/admin-test-parent').delete();
  await db.doc('fragrances/admin-test-child').delete();
  await deleteApp(app);
  for (const prefix of ['plans', 'backups', 'audit']) await archiveDb.recursiveDelete(archiveDb.collection(`archive-${prefix}`));
  await deleteApp(archiveApp);
});
test('dry-run makes no Firestore writes', async () => {
  const before = (await db.doc('dataAdminSmoke/smoke-test').get()).updateTime;
  await prepare(request('dry-run'), db, archive);
  assert.ok((await db.doc('dataAdminSmoke/smoke-test').get()).updateTime!.isEqual(before!));
  assert.equal((await db.doc('dataAdminOperations/dry-run').get()).exists, false);
});
test('write, backup readback, audit, retry and restore are idempotent', async () => {
  const req = request('write-idempotent'); const plan = await prepare(req, db, archive);
  const approved = { ...actor, approvedPlan: hash(plan) };
  const result = await apply(req, plan, db, archive, approved);
  assert.equal((await db.doc('dataAdminSmoke/smoke-test').get()).data()?.value, 20);
  assert.equal((await db.doc('dataAdminOperations/write-idempotent').get()).data()?.actor.requestSha, actor.requestSha);
  assert.equal((await apply(req, plan, db, archive, approved)).status, 'already-complete');
  assert.ok([...archive.objects.keys()].some(p => p.startsWith('audit/')));
  const restore = validateRequest({ schemaVersion: 1, id: 'restore-idempotent', environment: 'dev', projectId: 'bem-feito-dev', operation: 'restore', backup: result.backup, destructive: { projectId: 'bem-feito-dev', paths: ['dataAdminSmoke/smoke-test'] } });
  const restorePlan = await prepare(restore, db, archive); const restoreActor = { ...actor, approvedPlan: hash(restorePlan) };
  await apply(restore, restorePlan, db, archive, restoreActor);
  await apply(restore, restorePlan, db, archive, restoreActor);
  assert.equal((await db.doc('dataAdminSmoke/smoke-test').get()).data()?.value, 10);
});
test('concurrent updates, changed expected values and wrong approval fail before modification', async () => {
  const req = request('race'); const plan = await prepare(req, db, archive);
  await db.doc('dataAdminSmoke/smoke-test').update({ value: 30 });
  await assert.rejects(apply(req, plan, db, archive, { ...actor, approvedPlan: hash(plan) }), /Concurrent/);
  assert.equal((await db.doc('dataAdminSmoke/smoke-test').get()).data()?.value, 30);
  assert.equal((await db.doc('dataAdminOperations/race').get()).exists, false);
  await assert.rejects(prepare(req, db, archive), /precondition/);
  await assert.rejects(apply(req, plan, db, archive, { ...actor, approvedPlan: 'f'.repeat(64) }), /approved/);
});
test('failed/unreadable archive aborts without data changes', async () => {
  const req = request('backup-fails'); const plan = await prepare(req, db, archive); archive.fail = true;
  await assert.rejects(apply(req, plan, db, archive, { ...actor, approvedPlan: hash(plan) }));
  assert.equal((await db.doc('dataAdminSmoke/smoke-test').get()).data()?.value, 10);
  assert.equal((await db.doc('dataAdminOperations/backup-fails').get()).exists, false);
});
test('delete is scoped to disposable administrative document, with verified restore', async () => {
  const req = request('delete-smoke', 'delete'); const plan = await prepare(req, db, archive);
  const result = await apply(req, plan, db, archive, { ...actor, approvedPlan: hash(plan) });
  assert.equal((await db.doc('dataAdminSmoke/smoke-test').get()).exists, false);
  const restore = validateRequest({ schemaVersion: 1, id: 'restore-deleted', environment: 'dev', projectId: 'bem-feito-dev', operation: 'restore', backup: result.backup, destructive: { projectId: 'bem-feito-dev', paths: ['dataAdminSmoke/smoke-test'] } });
  const restoration = await prepare(restore, db, archive);
  await apply(restore, restoration, db, archive, { ...actor, approvedPlan: hash(restoration) });
  assert.equal((await db.doc('dataAdminSmoke/smoke-test').get()).data()?.value, 10);
});
test('cost correction also updates the weighted cost basis without changing physical/reserved stock', async () => {
  await db.doc('inputs/admin-test-input').set({ averageUnitCostCents: 100, stock: 7, committedStock: 3, reservedPhysicalStock: 2, costBasisQuantity: 10, costBasisValueCents: 1000 });
  const req = validateRequest({ schemaVersion: 1, id: 'input-cost', environment: 'dev', projectId: 'bem-feito-dev', operation: 'update', changes: [{ collection: 'inputs', id: 'admin-test-input', action: 'update', expected: { averageUnitCostCents: 100 }, values: { averageUnitCostCents: 150 } }] });
  const plan = await prepare(req, db, archive);
  await apply(req, plan, db, archive, { ...actor, approvedPlan: hash(plan) });
  const data = (await db.doc('inputs/admin-test-input').get()).data()!;
  assert.deepEqual([data.costBasisQuantity, data.costBasisValueCents, data.stock, data.committedStock, data.reservedPhysicalStock], [10, 1500, 7, 3, 2]);
});
test('Firestore types survive backup/restore without marker collisions', () => {
  const value = { timestamp: new Timestamp(123, 456), point: new GeoPoint(-23, -46), bytes: Buffer.from('test'), ref: db.doc('inputs/a'), nan: NaN, nested: [{ $timestamp: 'literal-string' }] };
  assert.equal(hash(encode(decode(encode(value), db))), hash(encode(value)));
});
test('operation ID collision and changes after a receipt are detected without replaying writes', async () => {
  const req = request('collision'); const plan = await prepare(req, db, archive);
  await apply(req, plan, db, archive, { ...actor, approvedPlan: hash(plan) });
  const different = validateRequest({ ...req, changes: [{ ...req.changes![0], expected: { value: 20 }, values: { value: 25 } }] });
  const changedPlan = await prepare(different, db, archive);
  await assert.rejects(apply(different, changedPlan, db, archive, { ...actor, approvedPlan: hash(changedPlan) }), /another request/);
  await db.doc('dataAdminSmoke/smoke-test').update({ value: 30 });
  await assert.rejects(apply(req, plan, db, archive, { ...actor, approvedPlan: hash(plan) }), /Post-commit/);
  assert.equal((await db.doc('dataAdminSmoke/smoke-test').get()).data()?.value, 30);
});
test('relationship is checked again atomically after preview', async () => {
  await db.doc('collections/admin-test-parent').set({ name: 'Parent', active: true });
  const req = validateRequest({ schemaVersion: 1, id: 'relation-race', environment: 'dev', projectId: 'bem-feito-dev', operation: 'create', changes: [{ collection: 'fragrances', id: 'admin-test-child', action: 'create', expected: null, values: { name: 'Child', active: true, collectionId: 'admin-test-parent' } }] });
  const plan = await prepare(req, db, archive);
  await db.doc('collections/admin-test-parent').update({ active: false });
  await assert.rejects(apply(req, plan, db, archive, { ...actor, approvedPlan: hash(plan) }), /Concurrent relationship/);
  assert.equal((await db.doc('fragrances/admin-test-child').get()).exists, false);
});
test('registered replacement can commit and restore more than 500 documents atomically', async () => {
  const paths = Array.from({ length: 600 }, (_, i) => `dataAdminSmoke/smoke-bulk-${i}`);
  const req = validateRequest({ schemaVersion: 1, id: 'bulk-replacement', environment: 'dev', projectId: 'bem-feito-dev', operation: 'migrate', migration: 'legacy-sheets-v1', deploymentSha: 'a'.repeat(40), destructive: { projectId: 'bem-feito-dev', paths: ['dataAdminSmoke'] } });
  const snapshots = await db.getAll(...paths.map(p => db.doc(p)));
  const plan = { schemaVersion: 1 as const, requestHash: hash(req), projectId: req.projectId, environment: req.environment, operation: req.operation, scope: ['dataAdminSmoke'], rows: snapshots.map(s => ({ ...snapshotRow(s), after: encode({ value: 42 }) })), dependencies: [] };
  // Include the existing test document to exercise root-set concurrency protection.
  const existing = await db.doc('dataAdminSmoke/smoke-test').get(); plan.rows.push(snapshotRow(existing));
  const result = await apply(req, plan, db, archive, { ...actor, approvedPlan: hash(plan) });
  assert.equal((await db.collection('dataAdminSmoke').get()).size, 601);
  const restore = validateRequest({ schemaVersion: 1, id: 'restore-bulk', environment: 'dev', projectId: 'bem-feito-dev', operation: 'restore', backup: result.backup, destructive: { projectId: 'bem-feito-dev', paths: ['dataAdminSmoke'] } });
  const restoration = await prepare(restore, db, archive);
  await apply(restore, restoration, db, archive, { ...actor, approvedPlan: hash(restoration) });
  assert.equal((await db.collection('dataAdminSmoke').get()).size, 1);
  assert.throws(() => assertPlanCapacity(Array.from({ length: 2001 }, (_, i) => ({ path: `x/${i}`, version: null, before: encode(null), after: encode(null) }))));
});
test('independent Firestore archive chunks large private payloads, rereads checksums and creates idempotently', async () => {
  const storage = new FirestoreArchive(archiveDb);
  const value = { schemaVersion: 1, payload: 'x'.repeat(1_100_000) };
  const id = await storage.put('backups', value);
  assert.deepEqual(await storage.get('backups', id), value);
  const timestamp = (await archiveDb.doc(`archive-backups/${id}`).get()).updateTime!;
  assert.equal(await storage.put('backups', value), id);
  assert.ok((await archiveDb.doc(`archive-backups/${id}`).get()).updateTime!.isEqual(timestamp));
  assert.equal((await db.doc(`archive-backups/${id}`).get()).exists, false);
  await archiveDb.doc(`archive-backups/${id}/parts/0000`).update({ data: Buffer.from('tampered').toString('base64') });
  await assert.rejects(storage.get('backups', id), /checksum/);
});
test('executor backs up, audits and restores through the independent Firestore archive adapter', async () => {
  const storage = new FirestoreArchive(archiveDb);
  const req = request('archive-engine'); const plan = await prepare(req, db, storage);
  const result = await apply(req, plan, db, storage, { ...actor, approvedPlan: hash(plan) });
  assert.equal((await storage.get('backups', result.backup)).operationId, req.id);
  const restoration = validateRequest({ schemaVersion: 1, id: 'restore-archive-engine', environment: 'dev', projectId: 'bem-feito-dev', operation: 'restore', backup: result.backup, destructive: { projectId: 'bem-feito-dev', paths: ['dataAdminSmoke/smoke-test'] } });
  const restorePlan = await prepare(restoration, db, storage);
  await apply(restoration, restorePlan, db, storage, { ...actor, approvedPlan: hash(restorePlan) });
  assert.equal((await db.doc('dataAdminSmoke/smoke-test').get()).data()?.value, 10);
  assert.ok((await archiveDb.collection('archive-audit').get()).size >= 4);
});
test('archive access guard rejects excessive update privilege before a business operation', async () => {
  const storage = new FirestoreArchive(archiveDb);
  // The emulator has no IAM restrictions, so the guard must reject its excessive access.
  await assert.rejects(storage.assertAccess({ runId: 'emulator-probe', phase: 'preview' }), /unexpectedly permits commit update/);
  assert.equal((await db.doc('dataAdminSmoke/smoke-test').get()).data()?.value, 10);
});

