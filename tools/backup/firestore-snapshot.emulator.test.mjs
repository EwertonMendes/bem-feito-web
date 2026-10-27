import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backup, readSnapshot, digest } from './firestore-snapshot.mjs';

test('full snapshot restores into an independent empty emulator database without losing types', { skip: !process.env.FIRESTORE_EMULATOR_HOST }, async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  assert.match(host, /^(127\.0\.0\.1|localhost):\d+$/);
  const localName = value => value.replace('projects/bem-feito-prod/', 'projects/demo-backup-source/').replace('projects/bem-feito-archive-prod/', 'projects/demo-backup-archive/');
  const request = async (url, method = 'GET', body) => {
    const local = new URL(localName(url.replace('https://firestore.googleapis.com', 'http://' + host)));
    // REST historical reads are not implemented correctly by the emulator for
    // missing parents. The pure transport test covers one readTime; this drill
    // uses a static dataset and exercises actual persistence and recovery.
    local.searchParams.delete('readTime');
    if (body?.readTime) { body = { ...body }; delete body.readTime; }
    if (body?.writes) body = { ...body, writes: body.writes.map(w => ({ ...w, update: { ...w.update, name: localName(w.update.name) } })) };
    const response = await fetch(local, { method, headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    assert.ok(response.ok, 'Local emulator API rejected test operation: HTTP ' + response.status + (response.ok ? '' : ' ' + await response.text()));
    return response.json();
  };
  const docs = [
    { path: 'sales/s1', fields: { cents: { integerValue: '9007199254740993' }, at: { timestampValue: '2026-10-27T00:00:00.123456Z' }, bytes: { bytesValue: 'AAEC' } } },
    { path: 'parents/missing/children/c1', fields: { nested: { mapValue: { fields: { nil: { nullValue: null }, values: { arrayValue: { values: [{ booleanValue: true }] } } } } } } },
  ];
  await request('https://firestore.googleapis.com/v1/projects/bem-feito-prod/databases/(default)/documents:commit', 'POST', { writes: docs.map(d => ({ update: { name: 'projects/bem-feito-prod/databases/(default)/documents/' + d.path, fields: d.fields }, currentDocument: { exists: false } })) });
  const receipt = await backup(request);
  const snapshot = await readSnapshot(request, receipt.backupHash);
  assert.equal(snapshot.documents.length, 2);
  const recovery = 'http://' + host + '/v1/projects/demo-backup-recovery/databases/(default)/documents';
  const response = await fetch(recovery + ':commit', { method: 'POST', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: JSON.stringify({ writes: snapshot.documents.map(d => ({ update: { name: 'projects/demo-backup-recovery/databases/(default)/documents/' + d.path, fields: d.fields }, currentDocument: { exists: false } })) }) });
  assert.ok(response.ok);
  for (const doc of snapshot.documents) {
    const result = await (await fetch(recovery + '/' + doc.path, { headers: { Authorization: 'Bearer owner' } })).json();
    assert.equal(digest(result.fields), digest(doc.fields));
  }
});

