import { ApiError, type Env, type Connection, type Principal } from './types.ts';
import { context, decrypt, encrypt, random } from './crypto.ts';
import { exchange } from './google.ts';
const EXPIRY_SKEW_MS = 60_000, MAX_WAIT_MS = 8000;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve,ms));
async function row(env: Env, uid: string): Promise<Connection> {
  const connection = await env.DB.prepare('SELECT * FROM drive_connections WHERE owner_uid=?')
    .bind(uid).first<Connection>();
  if (connection?.status === 'revocation_pending') throw new ApiError(409,'revocation_pending');
  if (!connection || connection.status !== 'connected' || !connection.encrypted_refresh_token) {
    throw new ApiError(409,'reconnect_required');
  }
  return connection;
}
export async function state(env: Env, user: Principal): Promise<Response> {
  const connection = await env.DB.prepare(
    'SELECT google_subject,google_email,status,updated_at FROM drive_connections WHERE owner_uid=?'
  ).bind(user.uid).first<{google_subject:string;google_email:string;status:string;updated_at:number}>();
  const valid = connection && connection.status === 'connected' && connection.google_subject === user.googleSub &&
    connection.google_email.trim().toLowerCase() === user.email;
  return Response.json({linked: Boolean(valid),status:valid?'connected':'disconnected',
    email:valid?connection.google_email:null});
}
function validateOwner(connection: Connection, user: Principal): void {
  if (connection.google_subject !== user.googleSub || connection.google_email.toLowerCase() !== user.email) {
    throw new ApiError(409, 'google_identity_mismatch');
  }
}
async function cached(env: Env, c: Connection): Promise<{accessToken: string;expiresAt:number;email:string;version:string}|null> {
  if (!c.encrypted_access_token || !c.access_token_version || c.access_token_expires_at < Date.now() + EXPIRY_SKEW_MS) return null;
  return {
    version: c.access_token_version,
    accessToken: await decrypt(env,c.encrypted_access_token,context(env,c.owner_uid,c.google_subject,'access:'+c.revision+':'+c.access_token_version)),
    expiresAt:c.access_token_expires_at,email:c.google_email
  };
}
async function grant(env: Env, user: Principal): Promise<{accessToken:string;expiresAt:number;email:string;version:string}> {
  const started = Date.now();
  let attempt = 0;
  while (Date.now() - started < MAX_WAIT_MS) {
    const c = await row(env,user.uid);
    validateOwner(c,user);
    const hit = await cached(env,c);
    if (hit) return hit;
    if (c.refresh_retry_after > Date.now()) throw new ApiError(503,'refresh_retry_later');
    const lease = random(), now = Date.now();
    const acquired = await env.DB.prepare(
      `UPDATE drive_connections SET refresh_lease_id=?,refresh_lease_until=?
       WHERE owner_uid=? AND revision=? AND status='connected'
       AND refresh_lease_until<? AND refresh_retry_after<?`
    ).bind(lease,now+20000,user.uid,c.revision,now,now).run();
    if (acquired.meta.changes === 1) {
      let published = false;
      try {
        const previous = await decrypt(env,c.encrypted_refresh_token!,
          context(env,c.owner_uid,c.google_subject));
        const requestedAt = Date.now();
        const tokens = await exchange(env,{grant_type:'refresh_token',refresh_token:previous});
        const expiresAt = requestedAt + Math.floor(tokens.expires_in*1000);
        if (expiresAt < Date.now()+EXPIRY_SKEW_MS) throw new ApiError(502,'invalid_google_response');
        const nextRevision = c.revision + (tokens.refresh_token ? 1 : 0);
        const version = random();
        const access = await encrypt(env,tokens.access_token,
          context(env,c.owner_uid,c.google_subject,'access:'+nextRevision+':'+version));
        const rotated = tokens.refresh_token
          ? await encrypt(env,tokens.refresh_token,context(env,c.owner_uid,c.google_subject)) : null;
        const update = await env.DB.prepare(
          `UPDATE drive_connections SET encrypted_access_token=?,access_token_expires_at=?,access_token_version=?,
          encrypted_refresh_token=COALESCE(?,encrypted_refresh_token),revision=?,refresh_lease_id=NULL,
          refresh_lease_until=0,refresh_retry_after=0,updated_at=?
          WHERE owner_uid=? AND status='connected' AND revision=? AND refresh_lease_id=? AND refresh_lease_until>?`
        ).bind(access,expiresAt,version,rotated,nextRevision,Date.now(),
          user.uid,c.revision,lease,Date.now()).run();
        if (update.meta.changes !== 1) throw new ApiError(409,'connection_changed');
        published = true;
        return {accessToken:tokens.access_token,expiresAt,email:c.google_email,version};
      } catch (error) {
        if (error instanceof ApiError && error.code === 'reconnect_required') {
          await env.DB.prepare(
            `UPDATE drive_connections SET status='reconnect_required',encrypted_refresh_token=NULL,
              encrypted_access_token=NULL,access_token_expires_at=0,access_token_version=NULL,
              revision=revision+1,refresh_lease_id=NULL,refresh_lease_until=0,refresh_retry_after=0,updated_at=?
             WHERE owner_uid=? AND revision=? AND refresh_lease_id=?`
          ).bind(Date.now(),user.uid,c.revision,lease).run();
        }
        throw error;
      } finally {
        if (!published) await env.DB.prepare(
          `UPDATE drive_connections SET refresh_lease_id=NULL,refresh_lease_until=0,
           refresh_retry_after=? WHERE owner_uid=? AND revision=? AND refresh_lease_id=?`
        ).bind(Date.now()+2000,user.uid,c.revision,lease).run();
      }
    }
    await sleep(Math.min(100*2**attempt++,1000));
  }
  throw new ApiError(503,'refresh_busy');
}
export async function token(env: Env, user: Principal): Promise<Response> {
  const result = await grant(env,user);
  return Response.json(result);
}
export async function rejectToken(env: Env, user: Principal, request: Request): Promise<Response> {
  let payload: {version?: unknown};
  try { payload = await request.json() as {version?:unknown}; }
  catch { throw new ApiError(400,'invalid_request'); }
  if (typeof payload.version !== 'string' || !/^[a-zA-Z0-9_-]{43}$/.test(payload.version)) {
    throw new ApiError(400,'invalid_request');
  }
  const current = await row(env,user.uid);
  validateOwner(current,user);
  await env.DB.prepare(
    `UPDATE drive_connections SET encrypted_access_token=NULL,access_token_expires_at=0,
       access_token_version=NULL WHERE owner_uid=? AND status='connected' AND access_token_version=?`
  ).bind(user.uid,payload.version).run();
  return Response.json({status:'invalidated'});
}
export async function disconnect(env: Env, user: Principal): Promise<Response> {
  const existing = await env.DB.prepare('SELECT * FROM drive_connections WHERE owner_uid=?')
    .bind(user.uid).first<Connection>();
  if (!existing) return Response.json({status:'disconnected'});
  validateOwner(existing,user);
  if (existing.status === 'reconnect_required') {
    await env.DB.prepare('DELETE FROM drive_connections WHERE owner_uid=? AND revision=?')
      .bind(user.uid,existing.revision).run();
    return Response.json({status:'disconnected'});
  }
  if (existing.status === 'connected') {
    const changed = await env.DB.prepare(
      `UPDATE drive_connections SET status='revocation_pending',encrypted_access_token=NULL,
       access_token_expires_at=0,access_token_version=NULL,refresh_lease_id=NULL,refresh_lease_until=0,
       revision=revision+1,updated_at=? WHERE owner_uid=? AND revision=? AND status='connected'`
    ).bind(Date.now(),user.uid,existing.revision).run();
    if (changed.meta.changes !== 1) throw new ApiError(409,'connection_changed');
  } else if (existing.status !== 'revocation_pending') throw new ApiError(409,'connection_changed');

  const pendingRevision = existing.revision + (existing.status === 'connected' ? 1 : 0);
  // The grant is disabled before contacting Google. A failed upstream revoke remains
  // explicitly retryable, never silently marked disconnected.
  try {
    if (existing.encrypted_refresh_token) {
      const value = await decrypt(env,existing.encrypted_refresh_token,
        context(env,existing.owner_uid,existing.google_subject));
      const response = await fetch('https://oauth2.googleapis.com/revoke',{
        method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
        body:new URLSearchParams({token:value}),redirect:'manual',signal:AbortSignal.timeout(10000)
      });
      if (!response.ok) {
        const payload = await response.json().catch(()=>null) as {error?:string}|null;
        if (payload?.error !== 'invalid_token') throw new ApiError(503,'revocation_pending');
      }
    }
    await env.DB.prepare('DELETE FROM drive_connections WHERE owner_uid=? AND revision=? AND status=?')
      .bind(user.uid,pendingRevision,'revocation_pending').run();
    return Response.json({status:'disconnected'});
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(503,'revocation_pending');
  }
}
