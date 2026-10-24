import { ApiError, type Env, type Principal } from './types.ts';
import { random, sha, encrypt, decrypt, context } from './crypto.ts';
import { DRIVE_SCOPE, exchange } from './google.ts';
import { verifyJwt } from './jwt.ts';
const GOOGLE_JWKS = 'https://www.googleapis.com/oauth2/v3/certs';
const COOKIE = '__Host-bem-feito-oauth';
const TTL_MS = 10 * 60_000;
interface Transaction {
  owner_uid: string; firebase_email: string; firebase_google_sub: string;
  state_hash: string; encrypted_state: string; encrypted_verifier: string;
  nonce: string; expires_at: number;
}
function enabled(env: Env): void {
  if (env.OAUTH_ENABLED !== 'true' || !env.GOOGLE_CLIENT_SECRET || !env.TOKEN_KEYS) throw new ApiError(503, 'oauth_not_enabled');
}
export async function start(env: Env, user: Principal): Promise<Response> {
  enabled(env);
  const now = Date.now();
  await env.DB.prepare('DELETE FROM oauth_transactions WHERE expires_at < ?').bind(now).run();
  const state = random(), ticket = random(), verifier = random(), nonce = random();
  const digest = await sha(state);
  const result = await env.DB.prepare(
    `INSERT INTO oauth_transactions
     (state_hash,owner_uid,firebase_email,firebase_google_sub,encrypted_state,encrypted_verifier,nonce,launch_hash,browser_hash,expires_at,created_at)
     SELECT ?,?,?,?,?,?,?,?,NULL,?,?
     WHERE (SELECT COUNT(*) FROM oauth_transactions WHERE owner_uid=? AND created_at>?)<5`
  ).bind(digest, user.uid, user.email, user.googleSub,
    await encrypt(env, state, context(env,user.uid,digest,'oauth-state')),
    await encrypt(env, verifier, context(env,user.uid,digest,'oauth-pkce')), nonce,
    await sha(ticket), now + TTL_MS, now, user.uid, now - TTL_MS).run();
  if (result.meta.changes !== 1) throw new ApiError(429, 'oauth_rate_limited');
  const launchUrl = new URL('/oauth/drive/launch', env.OAUTH_REDIRECT_URI);
  launchUrl.searchParams.set('ticket', ticket);
  return Response.json({ launchUrl: launchUrl.toString() });
}
export async function launch(request: Request, env: Env): Promise<Response> {
  enabled(env);
  const ticket = new URL(request.url).searchParams.get('ticket');
  if (!ticket || !/^[A-Za-z0-9_-]{43}$/.test(ticket)) throw new ApiError(400, 'invalid_launch_ticket');
  const browser = random(), now = Date.now();
  const tx = await env.DB.prepare(
    `UPDATE oauth_transactions SET browser_hash=?,launch_hash=NULL
     WHERE launch_hash=? AND browser_hash IS NULL AND expires_at>? 
     RETURNING owner_uid,state_hash,encrypted_state,encrypted_verifier,nonce`
  ).bind(await sha(browser), await sha(ticket), now).first<Transaction>();
  if (!tx) throw new ApiError(400, 'expired_or_used_launch');
  const state = await decrypt(env, tx.encrypted_state, context(env, tx.owner_uid, tx.state_hash, 'oauth-state'));
  const verifier = await decrypt(env, tx.encrypted_verifier, context(env, tx.owner_uid, tx.state_hash, 'oauth-pkce'));
  const target = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  target.search = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: env.OAUTH_REDIRECT_URI,
    response_type: 'code', access_type: 'offline',
    prompt: 'consent select_account',
    scope: 'openid email ' + DRIVE_SCOPE, state, nonce: tx.nonce,
    code_challenge: await sha(verifier), code_challenge_method: 'S256'
  }).toString();
  return new Response(null,{ status: 303, headers: {
    Location: target.toString(),
    'Set-Cookie': COOKIE + '=' + browser + '; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=600'
  } });
}
function redirect(env: Env, code: string): Response {
  const url = new URL('/configuracoes', env.FRONTEND_ORIGIN);
  url.searchParams.set('drive', code);
  return new Response(null,{status:303,headers:{
    Location:url.toString(),
    'Set-Cookie':COOKIE+'=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0'
  }});
}
export async function callback(request: Request, env: Env): Promise<Response> {
  enabled(env);
  const url = new URL(request.url);
  const state = url.searchParams.get('state');
  const cookie = request.headers.get('Cookie')?.split(';').map(s=>s.trim())
    .find(v=>v.startsWith(COOKIE+'='))?.slice(COOKIE.length+1);
  if (!state || !/^[A-Za-z0-9_-]{43}$/.test(state) ||
      !cookie || !/^[A-Za-z0-9_-]{43}$/.test(cookie)) throw new ApiError(400,'invalid_oauth_state');
  const stateHash = await sha(state);
  const tx = await env.DB.prepare(
    'DELETE FROM oauth_transactions WHERE state_hash=? AND browser_hash=? AND expires_at>? RETURNING *'
  ).bind(stateHash, await sha(cookie), Date.now()).first<Transaction>();
  if (!tx) throw new ApiError(400,'expired_or_used_oauth_state');
  if (url.searchParams.has('error')) return redirect(env,'cancelled');
  const code = url.searchParams.get('code');
  if (!code || code.length > 4096) return redirect(env,'invalid_code');
  try {
    const verifier = await decrypt(env,tx.encrypted_verifier,context(env,tx.owner_uid,stateHash,'oauth-pkce'));
    const tokens = await exchange(env,{grant_type:'authorization_code',code,redirect_uri:env.OAUTH_REDIRECT_URI,code_verifier:verifier});
    if (!tokens.id_token) throw new ApiError(409,'google_identity_missing');
    const id = await verifyJwt(tokens.id_token, GOOGLE_JWKS,
      ['https://accounts.google.com','accounts.google.com'],env.GOOGLE_CLIENT_ID,['nonce','email','email_verified']);
    if (id.nonce !== tx.nonce || id.email_verified !== true || typeof id.email !== 'string' ||
        id.email.trim().toLowerCase() !== tx.firebase_email ||
        id.sub !== tx.firebase_google_sub) throw new ApiError(403,'google_identity_mismatch');
    if (typeof tokens.scope === 'string' && !tokens.scope.split(/\s+/).includes(DRIVE_SCOPE)) {
      throw new ApiError(403,'drive_scope_missing');
    }
    // Confirm that the new OAuth client is actually authorized for Drive.
    const probe = await fetch('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)',{
      headers: {Authorization:'Bearer '+tokens.access_token},
      redirect:'manual',signal:AbortSignal.timeout(10000)
    });
    if (!probe.ok) throw new ApiError(409,'drive_scope_missing');
    const drive = await probe.json() as {user?:{emailAddress?:string}};
    if (drive.user?.emailAddress?.trim().toLowerCase() !== tx.firebase_email) throw new ApiError(403,'google_identity_mismatch');
    const previous = await env.DB.prepare(
      'SELECT encrypted_refresh_token,status,google_subject FROM drive_connections WHERE owner_uid=?'
    ).bind(tx.owner_uid).first<{encrypted_refresh_token:string|null;status:string;google_subject:string}>();
    // Never reuse a refresh token that belongs to another Google account or an invalidated grant.
    if (previous?.status === 'revocation_pending') throw new ApiError(409,'revocation_pending');
    const retained = previous?.status === 'connected' && previous.google_subject === id.sub
      ? previous.encrypted_refresh_token : null;
    if (!tokens.refresh_token && !retained) throw new ApiError(409,'offline_access_unavailable');
    const encryptedRefresh = tokens.refresh_token
      ? await encrypt(env,tokens.refresh_token,context(env,tx.owner_uid,id.sub!))
      : retained!;
    const now = Date.now();
    const saved = await env.DB.prepare(
      `INSERT INTO drive_connections
        (owner_uid,google_subject,google_email,encrypted_refresh_token,encrypted_access_token,access_token_expires_at,
         access_token_version,status,revision,refresh_lease_id,refresh_lease_until,refresh_retry_after,created_at,updated_at)
       VALUES (?,?,?,?,NULL,0,NULL,'connected',1,NULL,0,0,?,?)
       ON CONFLICT(owner_uid) DO UPDATE SET google_subject=excluded.google_subject,google_email=excluded.google_email,
       encrypted_refresh_token=excluded.encrypted_refresh_token,encrypted_access_token=NULL,access_token_expires_at=0,
       access_token_version=NULL,status='connected',revision=drive_connections.revision+1,
       refresh_lease_id=NULL,refresh_lease_until=0,refresh_retry_after=0,updated_at=excluded.updated_at
       WHERE drive_connections.status!='revocation_pending'`
    ).bind(tx.owner_uid,id.sub,tx.firebase_email,encryptedRefresh,now,now).run();
    if (saved.meta.changes !== 1) throw new ApiError(409,'connection_changed');
    return redirect(env,'connected');
  } catch (error) {
    const allowed = new Set(['offline_access_unavailable','google_identity_mismatch','drive_scope_missing',
      'google_identity_missing','oauth_client_invalid','google_temporarily_unavailable','reconnect_required']);
    return redirect(env,error instanceof ApiError && allowed.has(error.code)?error.code:'connection_failed');
  }
}
