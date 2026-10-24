import { ApiError, type Env } from './types.ts';
const encoder = new TextEncoder();
export function b64url(bytes: Uint8Array): string {
  let raw = ''; for (const byte of bytes) raw += String.fromCharCode(byte);
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
export function decode(value: string): Uint8Array<ArrayBuffer> {
  const raw = atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}
export function random(): string { return b64url(crypto.getRandomValues(new Uint8Array(32))); }
export async function sha(value: string): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))));
}
export function context(env: Env, uid: string, account: string, kind = 'refresh'): string {
  return JSON.stringify(['bem-feito', env.ENVIRONMENT, uid, account, kind]);
}
async function key(env: Env, version: string): Promise<CryptoKey> {
  let secrets: Record<string, string>;
  try { secrets = JSON.parse(env.TOKEN_KEYS); } catch { throw new ApiError(503, 'encryption_not_configured'); }
  if (!secrets[version]) throw new ApiError(503, 'encryption_key_unavailable');
  const raw = decode(secrets[version]);
  if (raw.byteLength !== 32) throw new ApiError(503, 'invalid_encryption_key');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function encrypt(env: Env, value: string, aad: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: encoder.encode(aad) },
    await key(env, env.TOKEN_KEY_VERSION), encoder.encode(value)
  );
  return JSON.stringify({ v: env.TOKEN_KEY_VERSION, iv: b64url(iv), data: b64url(new Uint8Array(ciphertext)) });
}
export async function decrypt(env: Env, envelope: string, aad: string): Promise<string> {
  let item: {v: string; iv: string; data: string};
  try { item = JSON.parse(envelope); } catch { throw new ApiError(503, 'invalid_encrypted_record'); }
  const content = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: decode(item.iv), additionalData: encoder.encode(aad) },
    await key(env, item.v), decode(item.data)
  );
  return new TextDecoder().decode(content);
}
