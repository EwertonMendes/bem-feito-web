import { decode } from './crypto.ts';
import { ApiError } from './types.ts';

interface JwtHeader { alg?: string; kid?: string; typ?: string; }
export type Claims = Record<string, unknown> & {
  sub?: string; iss?: string; aud?: string | string[];
  exp?: number; iat?: number; nonce?: string;
  email?: string; email_verified?: boolean; auth_time?: number;
  firebase?: unknown;
};
type Jwk = JsonWebKey & { kid?: string };
const jwksCache = new Map<string, { expiresAt: number; keys: Jwk[] }>();

// Error stages distinguish a malformed or wrong-project Firebase ID token from a
// genuine signature mismatch without ever logging a token, UID or email.
function reject(stage: string): never {
  throw new ApiError(401, 'invalid_identity_' + stage);
}

async function keys(url: string, reload = false): Promise<Jwk[]> {
  const hit = jwksCache.get(url);
  if (!reload && hit && hit.expiresAt > Date.now()) return hit.keys;
  let response: Response;
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      redirect: 'error'
    });
  } catch { throw new ApiError(503, 'identity_keys_unavailable'); }
  if (!response.ok) throw new ApiError(503, 'identity_keys_unavailable');
  let result: { keys?: Jwk[] };
  try { result = await response.json() as { keys?: Jwk[] }; }
  catch { throw new ApiError(503, 'identity_keys_unavailable'); }
  if (!Array.isArray(result.keys) || !result.keys.length) throw new ApiError(503, 'identity_keys_unavailable');
  const cacheSeconds = Number(response.headers.get('Cache-Control')?.match(/(?:^|,)\s*max-age=(\d+)/)?.[1] ?? 600);
  const ttl = Math.max(60, Math.min(Number.isFinite(cacheSeconds) ? cacheSeconds : 600, 3600));
  jwksCache.set(url, { keys: result.keys, expiresAt: Date.now() + ttl * 1000 });
  return result.keys;
}

export async function verifyJwt(
  raw: string, url: string, issuer: string | string[], audience: string, required: string[] = []
): Promise<Claims> {
  if (raw.length > 8192) reject('malformed');
  const parts = raw.split('.');
  if (parts.length !== 3 || parts.some(part => !/^[A-Za-z0-9_-]+$/.test(part))) reject('malformed');
  let header: JwtHeader;
  try { header = JSON.parse(new TextDecoder().decode(decode(parts[0]!))) as JwtHeader; }
  catch { return reject('malformed'); }
  if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid) reject('algorithm');

  let available = await keys(url);
  let candidate = available.find(k => k.kid === header.kid && k.kty === 'RSA' && (k.alg === undefined || k.alg === 'RS256'));
  if (!candidate) {
    available = await keys(url, true);
    candidate = available.find(k => k.kid === header.kid && k.kty === 'RSA' && (k.alg === undefined || k.alg === 'RS256'));
  }
  if (!candidate) reject('key_not_found');

  let verified = false;
  try {
    const key = await crypto.subtle.importKey(
      'jwk', candidate, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']
    );
    verified = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5', key, decode(parts[2]!),
      new TextEncoder().encode(parts[0]! + '.' + parts[1]!)
    );
  } catch { reject('signature'); }
  if (!verified) reject('signature');

  let payload: Claims;
  try { payload = JSON.parse(new TextDecoder().decode(decode(parts[1]!))) as Claims; }
  catch { return reject('malformed'); }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) reject('malformed');
  const validIssuers = Array.isArray(issuer) ? issuer : [issuer];
  if (!validIssuers.includes(String(payload.iss))) reject('issuer');
  if (!(payload.aud === audience || (Array.isArray(payload.aud) && payload.aud.includes(audience)))) reject('audience');
  const now = Math.floor(Date.now()/1000);
  if (typeof payload.exp !== 'number' || payload.exp <= now) reject('expired');
  if (typeof payload.iat !== 'number' || payload.iat > now + 5 || payload.iat > payload.exp) reject('issued_at');
  if (typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 128) reject('subject');
  if (required.some(field => payload[field] === undefined || payload[field] === null)) reject('claims');
  return payload;
}
