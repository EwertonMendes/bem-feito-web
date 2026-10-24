import { ApiError, type Env, type Principal } from './types.ts';
import { verifyJwt } from './jwt.ts';
const FIREBASE_JWKS = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
const ROLES = new Set(['owner', 'operator', 'viewer']);
export async function principal(request: Request, env: Env): Promise<Principal> {
  const auth = request.headers.get('Authorization') ?? '';
  if (!auth.startsWith('Bearer ') || auth.length > 8199) throw new ApiError(401, 'authentication_required');
  const jwt = auth.slice(7);
  const claims = await verifyJwt(jwt, FIREBASE_JWKS, 'https://securetoken.google.com/' + env.FIREBASE_PROJECT_ID, env.FIREBASE_PROJECT_ID, ['auth_time']);
  const firebase = claims.firebase as { sign_in_provider?: string; identities?: { 'google.com'?: unknown } } | undefined;
  const google = firebase?.identities?.['google.com'];
  if (claims.email_verified !== true || typeof claims.email !== 'string' || !claims.email ||
      firebase?.sign_in_provider !== 'google.com' || !Array.isArray(google) ||
      google.length !== 1 || typeof google[0] !== 'string' || !google[0] ||
      typeof claims.auth_time !== 'number' || claims.auth_time > Math.floor(Date.now() / 1000) + 5) {
    throw new ApiError(403, 'google_identity_required');
  }
  const uid = claims.sub!;
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(uid)) throw new ApiError(401, 'invalid_identity');
  const url = 'https://firestore.googleapis.com/v1/projects/' + encodeURIComponent(env.FIREBASE_PROJECT_ID) +
    '/databases/(default)/documents/users/' + encodeURIComponent(uid);
  let response: Response;
  try {
    response = await fetch(url, { headers: { Authorization: 'Bearer ' + jwt }, redirect: 'error', signal: AbortSignal.timeout(8000) });
  } catch { throw new ApiError(503, 'user_profile_unavailable'); }
  if (response.status === 401 || response.status === 403 || response.status === 404) throw new ApiError(403, 'user_not_authorized');
  if (!response.ok) throw new ApiError(503, 'user_profile_unavailable');
  const data = await response.json() as { fields?: { active?: {booleanValue?: boolean}; role?: {stringValue?: string}; email?: {stringValue?: string} } };
  const role = data.fields?.role?.stringValue;
  if (data.fields?.active?.booleanValue !== true || !role || !ROLES.has(role)) throw new ApiError(403, 'user_not_authorized');
  const email = claims.email.trim().toLowerCase();
  if (data.fields?.email?.stringValue?.trim().toLowerCase() !== email) throw new ApiError(403, 'user_identity_mismatch');
  return { uid, email, googleSub: google[0], role: role as Principal['role'] };
}
export function sameOrigin(request: Request, env: Env): void {
  if (request.headers.get('Origin') !== env.FRONTEND_ORIGIN) throw new ApiError(403, 'origin_denied');
}
