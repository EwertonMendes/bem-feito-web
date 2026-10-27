import { createHash } from 'node:crypto';
import { GoogleAuth } from 'google-auth-library';
import { cloudRequest } from '../data-admin/cloud-access.mjs';

export function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
export const digest = value => createHash('sha256').update(canonical(value)).digest('hex');
const bytesDigest = value => createHash('sha256').update(value).digest('hex');
const assert = (condition, message) => { if (!condition) throw Error(message); };
const string = stringValue => ({ stringValue });
const integer = value => ({ integerValue: String(value) });

export async function captureSnapshot(request, projectId, readTime = new Date(Date.now() - 5000).toISOString()) {
  assert(projectId === 'bem-feito-prod', 'Only the configured PROD database may be backed up');
  const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
  const documents = [];
  async function gather(parent) {
    let collectionPage;
    do {
      const collections = await request(parent + ':listCollectionIds', 'POST', {
        pageSize: 100, readTime, ...(collectionPage ? { pageToken: collectionPage } : {}),
      });
      for (const collection of collections.collectionIds ?? []) {
        let documentPage;
        do {
          const url = new URL(parent + '/' + collection);
          url.searchParams.set('pageSize', '300');
          url.searchParams.set('showMissing', 'true');
          url.searchParams.set('readTime', readTime);
          if (documentPage) url.searchParams.set('pageToken', documentPage);
          const page = await request(url.href);
          for (const row of page.documents ?? []) {
            if (row.fields) documents.push({ path: row.name.split('/documents/')[1], fields: row.fields, updateTime: row.updateTime });
            assert(documents.length <= 10000, 'Snapshot capacity exceeded; no partial backup will be stored');
            await gather('https://firestore.googleapis.com/v1/' + row.name);
          }
          documentPage = page.nextPageToken;
        } while (documentPage);
      }
      collectionPage = collections.nextPageToken;
    } while (collectionPage);
  }
  await gather(base);
  documents.sort((a, b) => a.path.localeCompare(b.path));
  assert(new Set(documents.map(d => d.path)).size === documents.length, 'Duplicate snapshot paths');
  return { schemaVersion: 1, kind: 'full-firestore-snapshot', format: 'firestore-rest-v1', projectId, databaseId: '(default)', snapshotReadTime: readTime, documents };
}

export function archiveWrites(snapshot) {
  const hash = digest(snapshot);
  const buffer = Buffer.from(JSON.stringify(snapshot));
  assert(buffer.length <= 6000000, 'Snapshot exceeds archive capacity; capacity planning required');
  const chunks = Array.from({ length: Math.ceil(buffer.length / 400000) }, (_, i) => buffer.subarray(i * 400000, (i + 1) * 400000));
  const name = `projects/bem-feito-archive-prod/databases/(default)/documents/archive-backups/${hash}`;
  const writes = [{ update: { name, fields: { schemaVersion: integer(1), sha256: string(hash), size: integer(buffer.length), parts: integer(chunks.length), encoding: string('json-utf8-base64'), retention: string('indefinite-no-technical-delete') } }, currentDocument: { exists: false } }];
  for (const [i, chunk] of chunks.entries()) writes.push({ update: { name: name + '/parts/' + String(i).padStart(4, '0'), fields: { data: string(chunk.toString('base64')), checksum: string(bytesDigest(chunk)) } }, currentDocument: { exists: false } });
  return { hash, name, writes };
}

export async function readSnapshot(request, hash) {
  assert(/^[a-f0-9]{64}$/.test(hash), 'Invalid backup digest');
  const name = `https://firestore.googleapis.com/v1/projects/bem-feito-archive-prod/databases/(default)/documents/archive-backups/${hash}`;
  const manifest = (await request(name)).fields;
  const count = Number(manifest.parts?.integerValue);
  assert(manifest.sha256?.stringValue === hash && manifest.encoding?.stringValue === 'json-utf8-base64' && Number.isInteger(count) && count > 0 && count <= 15 && Number(manifest.size?.integerValue) <= 6000000, 'Invalid archive manifest');
  const chunks = [];
  for (let i = 0; i < count; i++) {
    const part = (await request(name + '/parts/' + String(i).padStart(4, '0'))).fields;
    const chunk = Buffer.from(part.data.stringValue, 'base64');
    assert(bytesDigest(chunk) === part.checksum.stringValue, 'Backup chunk checksum mismatch');
    chunks.push(chunk);
  }
  const buffer = Buffer.concat(chunks);
  assert(buffer.length === Number(manifest.size.integerValue), 'Backup byte length mismatch');
  const snapshot = JSON.parse(buffer.toString('utf8'));
  assert(digest(snapshot) === hash, 'Backup digest mismatch');
  return snapshot;
}

export async function backup(request) {
  const snapshot = await captureSnapshot(request, 'bem-feito-prod');
  const encoded = archiveWrites(snapshot);
  // One atomic create-only commit, using the same format as FirestoreArchive.
  await request('https://firestore.googleapis.com/v1/projects/bem-feito-archive-prod/databases/(default)/documents:commit', 'POST', { writes: encoded.writes });
  const recovered = await readSnapshot(request, encoded.hash);
  assert(digest(recovered) === digest(snapshot), 'Archive readback mismatch');
  return { schemaVersion: 1, projectId: snapshot.projectId, backupHash: encoded.hash, snapshotReadTime: snapshot.snapshotReadTime, documentCount: snapshot.documents.length, readbackVerified: true, payloadBytes: Buffer.byteLength(JSON.stringify(snapshot)) };
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('/firestore-snapshot.mjs')) {
  try {
    assert(process.env.GITHUB_ACTIONS === 'true' && process.env.GITHUB_REPOSITORY === 'EwertonMendes/bem-feito-web' && process.env.GITHUB_REF === 'refs/heads/master' && ['schedule', 'workflow_dispatch'].includes(process.env.GITHUB_EVENT_NAME) && process.env.GITHUB_ENVIRONMENT === 'backup-prod', 'Protected backup workflow required');
    const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
    console.log(JSON.stringify(await backup((url, method, data) => cloudRequest(auth, url, method, data))));
  } catch {
    console.error('Full PROD backup failed; private payload suppressed. Check identity, quota and archive capacity.');
    process.exitCode = 1;
  }
}
