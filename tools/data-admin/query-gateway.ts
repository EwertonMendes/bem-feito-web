import { createCipheriv, createPublicKey, publicEncrypt, constants, randomBytes, createHash } from 'node:crypto';
import { FieldPath, type Firestore, type Query, type WhereFilterOp } from 'firebase-admin/firestore';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Filter = { field: string; op: '==' | '<' | '<=' | '>' | '>=' | 'in'; value: Json };
export type Find = { name: string; collection: string; filters: Filter[]; limit: number; orderBy?: { field: string; direction: 'asc' | 'desc' }[]; select?: string[] };
export type Lookup = { name: string; from: string; path: string; collection: string; limit: number };
export type QueryPlan = { schemaVersion: 1; environment: 'dev'; projectId: 'bem-feito-dev'; queries: Find[]; lookups?: Lookup[] };

const COLLECTIONS = new Set([
  'collections', 'fragrances', 'formats', 'formatPrices', 'units', 'paymentMethods',
  'expenseCategories', 'expenseTypes', 'inputs', 'products', 'kits', 'additions',
  'expenses', 'productions', 'sales', 'payments', 'stockAdjustments', 'stockMovements',
]);
const MAX_TOTAL = 120;
const FIELD = /^[A-Za-z][A-Za-z0-9_]{0,63}(?:\.[A-Za-z][A-Za-z0-9_]{0,63}){0,3}$/;
const SECRET_FIELDS = new Set(['customerName', 'customerPhone', 'customerEmail', 'phone', 'email', 'address', 'notes', 'description']);
const exact = (value: Record<string, unknown>, allowed: string[]) => {
  if (Object.keys(value).some(k => !allowed.includes(k) || ['__proto__', 'prototype', 'constructor'].includes(k))) throw Error('Unexpected query property');
};
const obj = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw Error('Expected query object');
  return v as Record<string, unknown>;
};
const field = (v: unknown): string => {
  if (typeof v !== 'string' || !FIELD.test(v) || v.split('.').some(k => SECRET_FIELDS.has(k))) throw Error('Query field not allowed');
  return v;
};
const name = (v: unknown): string => {
  if (typeof v !== 'string' || !/^[a-z][a-z0-9_-]{0,35}$/.test(v)) throw Error('Invalid query name');
  return v;
};
const collection = (v: unknown): string => {
  if (typeof v !== 'string' || !COLLECTIONS.has(v)) throw Error('Collection not allowed');
  return v;
};
const count = (v: unknown, max: number): number => {
  if (!Number.isSafeInteger(v) || (v as number) < 1 || (v as number) > max) throw Error('Query limit exceeded');
  return v as number;
};
const scalar = (v: unknown): v is string | number | boolean | null =>
  v === null || typeof v === 'boolean' || (typeof v === 'string' && v.length <= 120 && !/[\r\n\x00-\x1f]/.test(v)) ||
  (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1e12);

export function validateQueryPlan(input: string): QueryPlan {
  if (typeof input !== 'string' || input.length > 12000) throw Error('Invalid query length');
  let raw: unknown;
  try { raw = JSON.parse(input); } catch { throw Error('Invalid query JSON'); }
  const plan = obj(raw);
  exact(plan, ['schemaVersion', 'environment', 'projectId', 'queries', 'lookups']);
  if (plan.schemaVersion !== 1 || plan.environment !== 'dev' || plan.projectId !== 'bem-feito-dev') throw Error('Only Firestore DEV queries are supported');
  if (!Array.isArray(plan.queries) || plan.queries.length < 1 || plan.queries.length > 4) throw Error('Expected 1 to 4 queries');
  if (plan.lookups !== undefined && (!Array.isArray(plan.lookups) || plan.lookups.length > 4)) throw Error('At most 4 lookups');
  let total = 0;
  const aliases = new Set<string>();
  for (const candidate of plan.queries) {
    const q = obj(candidate); exact(q, ['name', 'collection', 'filters', 'limit', 'orderBy', 'select']);
    const id = name(q.name); if (aliases.has(id)) throw Error('Duplicate query name'); aliases.add(id);
    collection(q.collection); total += count(q.limit, 40);
    if (!Array.isArray(q.filters) || q.filters.length < 1 || q.filters.length > 3) throw Error('A bounded filtered query is required');
    for (const f of q.filters) {
      const v = obj(f); exact(v, ['field', 'op', 'value']); field(v.field);
      if (!['==', '>', '<', '>=', '<=', 'in'].includes(String(v.op))) throw Error('Filter operator not allowed');
      if (v.op === 'in') {
        if (!Array.isArray(v.value) || v.value.length < 1 || v.value.length > 10 || !v.value.every(scalar)) throw Error('Invalid IN filter');
      } else if (!scalar(v.value)) throw Error('Invalid filter value');
    }
    if (q.orderBy !== undefined) {
      if (!Array.isArray(q.orderBy) || q.orderBy.length > 2) throw Error('Invalid ordering');
      for (const s of q.orderBy) {
        const v = obj(s); exact(v, ['field', 'direction']); field(v.field);
        if (!['asc', 'desc'].includes(String(v.direction))) throw Error('Invalid ordering direction');
      }
    }
    if (q.select !== undefined) {
      if (!Array.isArray(q.select) || q.select.length < 1 || q.select.length > 30) throw Error('Invalid projection');
      const paths = q.select.map(field);
      if (new Set(paths).size !== paths.length) throw Error('Duplicate projection');
    }
  }
  for (const candidate of (plan.lookups ?? []) as unknown[]) {
    const l = obj(candidate); exact(l, ['name', 'from', 'path', 'collection', 'limit']);
    const alias = name(l.name), source = name(l.from);
    if (aliases.has(alias) || !aliases.has(source)) throw Error('Invalid lookup relationship');
    aliases.add(alias); collection(l.collection); total += count(l.limit, 40);
    if (typeof l.path !== 'string' || l.path.length > 140 ||
        !/^[A-Za-z][A-Za-z0-9_]*(?:\[\])?(?:\.[A-Za-z][A-Za-z0-9_]*(?:\[\])?){0,3}$/.test(l.path) ||
        l.path.split('.').some(s => SECRET_FIELDS.has(s.replace('[]', '')))) throw Error('Invalid lookup path');
  }
  if (total > MAX_TOTAL) throw Error('Request exceeds the 120-document read budget');
  return plan as QueryPlan;
}

export function validateRecipientKey(base64: string) {
  if (typeof base64 !== 'string' || base64.length < 500 || base64.length > 1200 ||
      !/^[A-Za-z0-9_-]+$/.test(base64)) throw Error('Invalid recipient key');
  let key;
  try { key = createPublicKey({ key: Buffer.from(base64, 'base64url'), format: 'der', type: 'spki' }); }
  catch { throw Error('Invalid recipient public key'); }
  if (key.asymmetricKeyType !== 'rsa' || (key.asymmetricKeyDetails?.modulusLength ?? 0) < 3072 ||
      key.asymmetricKeyDetails?.publicExponent !== 65537n) throw Error('RSA-3072 recipient key required');
  return key;
}
const normalize = (value: unknown, depth = 0): Json => {
  if (depth > 12) throw Error('Document nesting exceeds gateway limit');
  if (value == null || typeof value === 'boolean' || typeof value === 'string') return value as Json;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw Error('Non-finite document value');
    return value;
  }
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(v => normalize(v, depth + 1));
  if (typeof value === 'object') {
    const o = value as Record<string, unknown>;
    if (typeof o.toDate === 'function') return normalize((o.toDate as () => Date)(), depth + 1);
    if (typeof o.path === 'string' && typeof o.id === 'string' && o.firestore) return o.path;
    if (Buffer.isBuffer(value)) return '[binary]';
    const entries = Object.entries(o);
    if (entries.length > 250) throw Error('Document has too many fields');
    return Object.fromEntries(entries.filter(([key]) => !['__proto__', 'prototype', 'constructor'].includes(key)).map(([key,v]) => [key,normalize(v,depth + 1)]));
  }
  throw Error('Unsupported document data type');
};
const extract = (value: unknown, path: string): string[] => {
  let nodes: unknown[] = [value];
  for (const part of path.split('.')) {
    const many = part.endsWith('[]'), key = many ? part.slice(0, -2) : part;
    nodes = nodes.flatMap(node => {
      const next = node && typeof node === 'object' ? (node as Record<string, unknown>)[key] : undefined;
      return many && Array.isArray(next) ? next : [next];
    });
  }
  return nodes.filter((v): v is string => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(v));
};
export async function executeQueryPlan(db: Firestore, plan: QueryPlan) {
  const results: { name: string; collection: string; documents: { id: string; data: Json }[] }[] = [];
  const lookupCache = new Map<string, { id: string; data: Json }>();
  let reads = 0;
  for (const q of plan.queries) {
    let query: Query = db.collection(q.collection);
    for (const f of q.filters) query = query.where(f.field === 'id' ? FieldPath.documentId() : f.field, f.op as WhereFilterOp, f.value);
    for (const order of q.orderBy ?? []) query = query.orderBy(order.field === 'id' ? FieldPath.documentId() : order.field, order.direction);
    if (q.select) query = query.select(...q.select);
    const snapshot = await query.limit(q.limit).get();
    reads += Math.max(1, snapshot.size);
    results.push({ name:q.name, collection:q.collection, documents:snapshot.docs.map(d => ({ id:d.id, data:normalize(d.data()) })) });
  }
  for (const l of plan.lookups ?? []) {
    const source = results.find(r => r.name === l.from);
    if (!source) throw Error('Missing lookup source');
    const refs = [...new Set(source.documents.flatMap(d => extract(d.data, l.path)))];
    if (refs.length > l.limit) throw Error('Lookup exceeded planned document limit');
    const toFetch = refs.filter(id => !lookupCache.has(l.collection + '/' + id));
    if (toFetch.length) {
      const docs = await db.getAll(...toFetch.map(id => db.doc(l.collection + '/' + id)));
      reads += docs.length;
      for (const d of docs) if (d.exists) lookupCache.set(d.ref.path, { id:d.id, data:normalize(d.data()) });
    }
    results.push({name:l.name,collection:l.collection,documents:refs.flatMap(id => {
      const d=lookupCache.get(l.collection + '/' + id); return d?[d]:[];
    })});
  }
  const plain = JSON.stringify({schemaVersion:1,projectId:'bem-feito-dev',createdAt:new Date().toISOString(),readEstimate:reads,results});
  if (Buffer.byteLength(plain, 'utf8') > 75000) throw Error('Encrypted result exceeds output budget; narrow the projection');
  return plain;
}

export function encryptResult(plaintext: string, publicKey: ReturnType<typeof validateRecipientKey>, queryInput: string) {
  const aesKey = randomBytes(32), iv = randomBytes(12);
  const aad = createHash('sha256').update(queryInput).digest();
  const cipher = createCipheriv('aes-256-gcm', aesKey, iv);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const wrappedKey = publicEncrypt({key:publicKey,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},aesKey);
  return Buffer.from(JSON.stringify({
    version:1,algorithm:'RSA-OAEP-SHA256+A256GCM',queryHash:aad.toString('hex'),
    key:wrappedKey.toString('base64url'),iv:iv.toString('base64url'),
    tag:cipher.getAuthTag().toString('base64url'),data:ciphertext.toString('base64url'),
  })).toString('base64url');
}
