import { hash, invariant } from './schema.ts';
export interface Archive {
  put(prefix: 'plans' | 'backups' | 'audit', value: any): Promise<string>;
  get(prefix: 'plans' | 'backups' | 'audit', id: string): Promise<any>;
}
export class BucketArchive implements Archive {
  private bucket: any;
  constructor(bucket: any) { this.bucket = bucket; }
  async put(prefix: 'plans' | 'backups' | 'audit', value: any) {
    const id = hash(value); const file = this.bucket.file(`${prefix}/${id}.json`);
    try { await file.save(JSON.stringify(value), { resumable: false, validation: 'crc32c', preconditionOpts: { ifGenerationMatch: 0 }, metadata: { contentType: 'application/json', cacheControl: 'no-store' } }); }
    catch (error: any) { if (Number(error.code) !== 412) throw new Error('Protected archive write failed'); }
    invariant(hash(await this.get(prefix, id)) === id, 'Archive readback differs'); return id;
  }
  async get(prefix: 'plans' | 'backups' | 'audit', id: string) {
    invariant(/^[a-f0-9]{64}$/.test(id), 'Invalid archive hash');
    const [buffer] = await this.bucket.file(`${prefix}/${id}.json`).download({ validation: 'crc32c' });
    invariant(buffer.length < 32_000_000, 'Archive exceeds limit');
    const value = JSON.parse(buffer.toString('utf8'));
    invariant(hash(value) === id, 'Archive checksum differs'); return value;
  }
}
