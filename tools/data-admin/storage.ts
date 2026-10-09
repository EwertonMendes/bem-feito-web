import { hash, invariant } from './schema.ts';
import { createHash } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
export interface Archive {
  put(prefix: 'plans' | 'backups' | 'audit', value: any): Promise<string>;
  get(prefix: 'plans' | 'backups' | 'audit', id: string): Promise<any>;
}
export class FirestoreArchive implements Archive {
  private db: Firestore;
  constructor(db: Firestore) { this.db = db; }
  private ref(prefix: string, id: string) {
    invariant(['plans', 'backups', 'audit'].includes(prefix) && /^[a-f0-9]{64}$/.test(id), 'Invalid archive hash');
    return this.db.doc(`archive-${prefix}/${id}`);
  }
  async assertAccess(context: { runId: string; phase: string }) {
    const id = await this.put('audit', { schemaVersion: 1, event: 'archive-iam-probe', ...context, at: new Date().toISOString() });
    const ref = this.ref('audit', id);
    async function denied(action: () => Promise<unknown>, name: string) {
      try { await action(); }
      catch (error: any) {
        invariant(Number(error.code) === 7, `Archive ${name} denial could not be verified`); return;
      }
      throw new Error(`Archive IAM unexpectedly permits ${name}; business writes blocked`);
    }
    // Probe only this synthetic audit manifest, preserving its content even if update is allowed.
    await denied(() => ref.update({ schemaVersion: 1 }), 'commit update');
    await denied(async () => {
      const bulk = this.db.bulkWriter(); bulk.onWriteError(() => false);
      try { await bulk.update(ref, { schemaVersion: 1 }); } finally { await bulk.close(); }
    }, 'batchWrite update');
    await denied(() => ref.delete(), 'delete');
    await denied(() => this.db.collection('archive-audit').limit(1).get(), 'list');
    await this.get('audit', id);
    return { createReadVerified: true, updateDeleteListDenied: true };
  }
  async put(prefix: 'plans' | 'backups' | 'audit', value: any) {
    const id = hash(value); const ref = this.ref(prefix, id);
    const buffer = Buffer.from(JSON.stringify(value), 'utf8');
    invariant(buffer.length <= 6_000_000, 'Archive exceeds safe atomic size');
    const chunks = Array.from({ length: Math.ceil(buffer.length / 400_000) }, (_, i) => buffer.subarray(i * 400_000, (i + 1) * 400_000));
    const batch = this.db.batch();
    batch.create(ref, { schemaVersion: 1, sha256: id, size: buffer.length, parts: chunks.length, encoding: 'json-utf8-base64', retention: 'indefinite-no-technical-delete' });
    for (const [i, chunk] of chunks.entries()) batch.create(ref.collection('parts').doc(String(i).padStart(4, '0')), { data: chunk.toString('base64'), checksum: createHash('sha256').update(chunk).digest('hex') });
    // Each write has exists:false; the manifest and all chunks are committed together.
    try { await batch.commit(); }
    catch (error: any) { if (Number(error.code) !== 6) throw new Error('Protected archive write failed; no business writes permitted'); }
    invariant(hash(await this.get(prefix, id)) === id, 'Archive readback differs'); return id;
  }
  async get(prefix: 'plans' | 'backups' | 'audit', id: string) {
    const ref = this.ref(prefix, id); const manifest = (await ref.get()).data();
    invariant(manifest?.schemaVersion === 1 && manifest.sha256 === id && manifest.encoding === 'json-utf8-base64' && Number.isSafeInteger(manifest.parts) && manifest.parts > 0 && manifest.parts <= 15 && manifest.size <= 6_000_000, 'Invalid or missing archive manifest');
    const snapshots = await this.db.getAll(...Array.from({ length: manifest.parts }, (_, i) => ref.collection('parts').doc(String(i).padStart(4, '0'))));
    const chunks = snapshots.map(s => {
      const part = s.data(); invariant(typeof part?.data === 'string' && part.data.length <= 533336, 'Invalid or missing archive part');
      const chunk = Buffer.from(part.data, 'base64');
      invariant(createHash('sha256').update(chunk).digest('hex') === part?.checksum, 'Archive chunk checksum differs'); return chunk;
    });
    const buffer = Buffer.concat(chunks);
    invariant(buffer.length === manifest.size, 'Archive byte length differs');
    const value = JSON.parse(buffer.toString('utf8'));
    invariant(hash(value) === id, 'Archive checksum differs'); return value;
  }
}
