import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { b64url, encrypt, context } from '../src/crypto.ts';
import { token, rejectToken } from '../src/tokens.ts';

const principal = { uid:'test-user', email:'user@example.test', googleSub:'google-sub', role:'owner' };
const envVars = {
  ENVIRONMENT:'dev',TOKEN_KEY_VERSION:'v1',
  TOKEN_KEYS:JSON.stringify({v1:b64url(randomBytes(32))}),
  GOOGLE_CLIENT_ID:'mock-client',GOOGLE_CLIENT_SECRET:randomBytes(16).toString('hex')
};
function db(initial) {
  const connection = {...initial};
  return {
    connection,
    prepare(sql) {
      return {
        bind(...args) {
          const changed=(yes)=>({meta:{changes:yes?1:0}});
          return {
            async first() {
              if (sql.includes('FROM drive_connections')) return {...connection};
              throw new Error('unexpected SELECT: '+sql);
            },
            async run() {
              if (sql.includes('SET refresh_lease_id=?,refresh_lease_until=?')) {
                const [lease,until,uid,revision,now,retryNow]=args;
                if (connection.owner_uid!==uid || connection.revision!==revision ||
                    connection.status!=='connected' || connection.refresh_lease_until>=now ||
                    connection.refresh_retry_after>=retryNow) return changed(false);
                connection.refresh_lease_id=lease;
                connection.refresh_lease_until=until;
                return changed(true);
              }
              if (sql.includes('SET encrypted_access_token=?,access_token_expires_at=?')) {
                const [access,expiry,version,refresh,revision,updated,uid,oldRevision,lease,now]=args;
                if (connection.owner_uid!==uid || connection.revision!==oldRevision ||
                    connection.status!=='connected' || connection.refresh_lease_id!==lease ||
                    connection.refresh_lease_until<=now) return changed(false);
                Object.assign(connection,{
                  encrypted_access_token:access,access_token_expires_at:expiry,
                  access_token_version:version,
                  encrypted_refresh_token:refresh??connection.encrypted_refresh_token,
                  revision,refresh_lease_id:null,refresh_lease_until:0,
                  refresh_retry_after:0,updated_at:updated
                });
                return changed(true);
              }
              if (sql.includes("SET status='reconnect_required'")) {
                const [updated,uid,revision,lease]=args;
                if (connection.owner_uid!==uid || connection.revision!==revision ||
                    connection.refresh_lease_id!==lease) return changed(false);
                Object.assign(connection,{
                  status:'reconnect_required',encrypted_refresh_token:null,
                  encrypted_access_token:null,access_token_expires_at:0,access_token_version:null,
                  revision:revision+1,refresh_lease_id:null,refresh_lease_until:0,
                  refresh_retry_after:0,updated_at:updated
                });
                return changed(true);
              }
              if (sql.includes('SET refresh_lease_id=NULL,refresh_lease_until=0')) {
                const [retryAfter,uid,revision,lease]=args;
                if (connection.owner_uid!==uid || connection.revision!==revision ||
                    connection.refresh_lease_id!==lease) return changed(false);
                Object.assign(connection,{refresh_lease_id:null,refresh_lease_until:0,refresh_retry_after:retryAfter});
                return changed(true);
              }
              if (sql.includes('SET encrypted_access_token=NULL,access_token_expires_at=0')) {
                const [uid,version]=args;
                if (connection.owner_uid!==uid || connection.status!=='connected' ||
                    connection.access_token_version!==version) return changed(false);
                Object.assign(connection,{encrypted_access_token:null,access_token_expires_at:0,access_token_version:null});
                return changed(true);
              }
              throw new Error('unexpected UPDATE: '+sql);
            }
          };
        }
      };
    }
  };
}
async function fixture(){
  const env = {...envVars};
  const encrypted_refresh_token=await encrypt(env,'refresh-for-test',context(env,principal.uid,principal.googleSub));
  const binding=db({
    owner_uid:principal.uid,google_subject:principal.googleSub,google_email:principal.email,
    encrypted_refresh_token,encrypted_access_token:null,access_token_expires_at:0,
    access_token_version:null,status:'connected',revision:1,refresh_lease_id:null,
    refresh_lease_until:0,refresh_retry_after:0,created_at:Date.now(),updated_at:Date.now()
  });
  return {...env, DB:binding};
}
describe('D1 access token broker',()=>{
  it('refreshes once with simultaneous requests, then reuses the encrypted cache',async()=>{
    const env=await fixture(),original=globalThis.fetch;
    let refreshes=0;
    const issuedToken=randomBytes(16).toString('hex');
    globalThis.fetch=async(url,init)=>{
      assert.equal(url,'https://oauth2.googleapis.com/token');
      assert.ok(String(init.body).includes('grant_type=refresh_token'));
      assert.ok(String(init.body).includes('refresh_token=refresh-for-test'));
      refreshes++;
      await new Promise(resolve=>setTimeout(resolve,60));
      return Response.json({access_token:issuedToken,token_type:'Bearer',expires_in:3600});
    };
    try {
      const results=await Promise.all(Array.from({length:8},()=>token(env,principal)));
      const first=await results[0].json();
      assert.equal(first.accessToken,issuedToken);
      assert.match(first.version,/^[A-Za-z0-9_-]{43}$/);
      assert.ok(results.every(r=>r.status===200));
      const another=await (await token(env,principal)).json();
      assert.equal(another.accessToken,issuedToken);
      assert.equal(refreshes,1);
      assert.ok(env.DB.connection.encrypted_access_token);
      assert.ok(!env.DB.connection.encrypted_access_token.includes(issuedToken));
    } finally {globalThis.fetch=original;}
  });

  it('ignores a late 401 for an obsolete access token',async()=>{
    const env=await fixture(),original=globalThis.fetch;
    const issuedToken=randomBytes(16).toString('hex');
    globalThis.fetch=async()=>Response.json({access_token:issuedToken,token_type:'Bearer',expires_in:3600});
    try {
      const fresh=await (await token(env,principal)).json();
      const result=await rejectToken(env,principal,new Request('https://worker.invalid/drive/token/reject',{
        method:'POST',body:JSON.stringify({version:'x'.repeat(43)})
      }));
      assert.equal(result.status,200);
      assert.equal(env.DB.connection.access_token_version,fresh.version);
      const cached=await (await token(env,principal)).json();
      assert.equal(cached.accessToken,issuedToken);
    } finally {globalThis.fetch=original;}
  });

  it('invalidates only the matching grant after invalid_grant',async()=>{
    const env=await fixture(),original=globalThis.fetch;
    globalThis.fetch=async()=>Response.json({error:'invalid_grant'},{status:400});
    try {
      await assert.rejects(token(env,principal),error=>error.code==='reconnect_required');
      assert.equal(env.DB.connection.status,'reconnect_required');
      assert.equal(env.DB.connection.encrypted_refresh_token,null);
      assert.equal(env.DB.connection.encrypted_access_token,null);
      assert.equal(env.DB.connection.revision,2);
    } finally {globalThis.fetch=original;}
  });
});
