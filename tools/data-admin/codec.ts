import { Timestamp, GeoPoint } from 'firebase-admin/firestore';
import { invariant } from './schema.ts';
import type { Firestore } from 'firebase-admin/firestore';

// Tagged tree avoids collisions with user payload keys and preserves Firestore types losslessly.
export function encode(value: any): any {
  if (value instanceof Timestamp) return ['timestamp', value.seconds, value.nanoseconds];
  if (value instanceof GeoPoint) return ['geo', value.latitude, value.longitude];
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return ['bytes', Buffer.from(value).toString('base64')];
  if (value && typeof value.path === 'string' && typeof value.get === 'function') return ['ref', value.path];
  if (Array.isArray(value)) return ['array', value.map(encode)];
  if (value && typeof value === 'object') return ['map', Object.fromEntries(Object.entries(value).map(([k, v]) => [k, encode(v)]))];
  if (typeof value === 'number' && !Number.isFinite(value)) return ['number', String(value)];
  invariant(value !== undefined, 'Undefined Firestore value'); return ['scalar', value];
}
export function decode(value: any, db: Firestore): any {
  invariant(Array.isArray(value), 'Invalid encoded value');
  switch (value[0]) {
    case 'timestamp': return new Timestamp(value[1], value[2]);
    case 'geo': return new GeoPoint(value[1], value[2]);
    case 'bytes': return Buffer.from(value[1], 'base64');
    case 'ref': return db.doc(value[1]);
    case 'array': return value[1].map((v: any) => decode(v, db));
    case 'map': return Object.fromEntries(Object.entries(value[1]).map(([k, v]) => [k, decode(v, db)]));
    case 'number': return Number(value[1]);
    case 'scalar': return value[1];
    default: throw new Error('Unsupported encoded Firestore value');
  }
}
