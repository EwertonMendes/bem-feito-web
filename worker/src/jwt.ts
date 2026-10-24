import { decode } from './crypto.ts';
import { ApiError } from './types.ts';
interface JwtHeader { alg?: string; kid?: string; typ?: string; }
export type Claims = Record<string, unknown> & { sub?: string; iss?: string; aud?: string | string[]; exp?: number; iat?: number; nonce?: string; email?: string; email_verified?: boolean; auth_time?: number; firebase?: unknown; };
type Jwk = JsonWebKey & {kid?: string};
const jwksCache = new Map<string, { expiresAt: number; keys: Jwk[] }>();
async function keys(url: string, reload = false): Promise<Jwk[]> {
  const hit = jwksCache.get(url);
  if (!reload && hit && hit.expiresAt > Date.now()) return hit.keys;
  const response = await fetch(url, { signal: AbortSignal.timeout(8000), redirect: 'error' });
  if (!response.ok) throw new ApiError(503, 'identity_keys_unavailable');
  const result = await response.json() as { keys?: Jwk[] };
  if (!Array.isArray(result.keys) || !result.keys.length) throw new ApiError(503, 'identity_keys_unavailable');
  jwksCache.set(url, { keys: result.keys, expiresAt: Date.now() + 60 * 60_000 });
  return result.keys;
}
export async function verifyJwt(
  raw: string, url: string, issuer: string | string[], audience: string, required: string[] = []
): Promise<Claims> {
  try {
    const parts = raw.split('.');
    if (parts.length !== 3 || raw.length > 8192) throw new Error('format');
    const header = JSON.parse(new TextDecoder().decode(decode(parts[0]!))) as JwtHeader;
    if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw new Error('algorithm');
    let jwks = await keys(url);
    let candidate = jwks.find(k => k.kid === header.kid && k.kty === 'RSA');
    if (!candidate) {
      jwks = await keys(url, true);
      candidate = jwks.find(k => k.kid === header.kid && k.kty === 'RSA');
    }
    if (!candidate) throw new Error('key');
    const key = await crypto.subtle.importKey('jwk', candidate, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const signature = decode(parts[2]!);
    if (!await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, new TextEncoder().encode(parts[0]! + '.' + parts[1]!))) throw new Error('signature');
    const payload = JSON.parse(new TextDecoder().decode(decode(parts[1]!))) as Claims;
    const now = Math.floor(Date.now() / 1000);
    const validIssuers = Array.isArray(issuer) ? issuer : [issuer];
    if (!validIssuers.includes(String(payload.iss)) ||
        !(payload.aud === audience || (Array.isArray(payload.aud) && payload.aud.includes(audience))) ||
        typeof payload.exp !== 'number' || payload.exp <= now - 5 ||
        typeof payload.iat !== 'number' || payload.iat > now + 5 ||
        typeof payload.sub !== 'string' || !payload.sub ||
        required.some(field => payload[field] === undefined || payload[field] === null)) throw new Error('claims');
    return payload;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(401, 'invalid_identity');
  }
}
