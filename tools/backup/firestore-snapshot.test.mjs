import { test } from 'node:test';
import assert from 'node:assert/strict';
import { archiveWrites, readSnapshot, captureSnapshot } from './firestore-snapshot.mjs';

test('archive roundtrip preserves Firestore types; checksum rejects corruption; writes never overwrite', async () => {
  const snapshot = { schemaVersion: 1, documents: [{ path: 'sales/a', fields: { precise: { integerValue: '9007199254740993' }, when: { timestampValue: '2026-10-27T00:00:00.123456Z' }, bytes: { bytesValue: 'AAEC' }, nested: { arrayValue: { values: [{ nullValue: null }] } } } }] };
  const encoded = archiveWrites(snapshot);
  assert.ok(encoded.writes.every(w => w.currentDocument.exists === false));
  const data = new Map(encoded.writes.map(w => ['https://firestore.googleapis.com/v1/' + w.update.name, w.update]));
  assert.deepEqual(await readSnapshot(async url => data.get(url), encoded.hash), snapshot);
  data.get('https://firestore.googleapis.com/v1/' + encoded.name + '/parts/0000').fields.data.stringValue = 'e30=';
  await assert.rejects(readSnapshot(async url => data.get(url), encoded.hash), /checksum/);
});

test('snapshot includes descendants of missing parents at one readTime and rejects DEV', async () => {
  const root = 'https://firestore.googleapis.com/v1/projects/bem-feito-prod/databases/(default)/documents';
  const time = '2026-10-27T00:00:00.000Z';
  const request = async (url, method, body) => {
    if (url.endsWith(':listCollectionIds')) {
      assert.equal(body.readTime, time);
      return { collectionIds: url === root + ':listCollectionIds' ? ['parents'] : url === root + '/parents/missing:listCollectionIds' ? ['children'] : [] };
    }
    const u = new URL(url); assert.equal(u.searchParams.get('readTime'), time);
    if (u.pathname.endsWith('/parents')) return { documents: [{ name: root.replace('https://firestore.googleapis.com/v1/', '') + '/parents/missing' }] };
    return { documents: [{ name: root.replace('https://firestore.googleapis.com/v1/', '') + '/parents/missing/children/child', fields: { value: { integerValue: '1' } }, updateTime: time }] };
  };
  const snapshot = await captureSnapshot(request, 'bem-feito-prod', time);
  assert.equal(snapshot.documents[0].path, 'parents/missing/children/child');
  await assert.rejects(captureSnapshot(request, 'bem-feito-dev', time));
});
