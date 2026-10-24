import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { b64url, random, encrypt, decrypt, context } from '../src/crypto.ts';
import { verifyJwt } from '../src/jwt.ts';
import worker from '../src/index.ts';
const env = {
  ENVIRONMENT:'dev',FIREBASE_PROJECT_ID:'bem-feito-dev',
  FRONTEND_ORIGIN:'https://bem-feito-dev.web.app',
  GOOGLE_CLIENT_ID:'fake-client',
  OAUTH_REDIRECT_URI:'https://bem-feito-drive-dev.ewertonmendes9.workers.dev/oauth/drive/callback',
  OAUTH_ENABLED:'false',TOKEN_KEY_VERSION:'v1',
  TOKEN_KEYS:JSON.stringify({v1:b64url(webcrypto.getRandomValues(new Uint8Array(32)))})
};
describe('Worker cryptographic boundaries',()=>{
  it('decrypts a credential only under the matching environment/user/account/AAD',async()=>{
    const encrypted=await encrypt(env,'refresh-secret',context(env,'owner','google-sub','refresh'));
    assert.equal(await decrypt(env,encrypted,context(env,'owner','google-sub','refresh')),'refresh-secret');
    await assert.rejects(decrypt(env,encrypted,context(env,'another','google-sub','refresh')));
    await assert.rejects(decrypt({...env,ENVIRONMENT:'production'},encrypted,context({...env,ENVIRONMENT:'production'},'owner','google-sub','refresh')));
    assert.equal(encrypted.includes('refresh-secret'),false);
    assert.equal(random().length,43);
  });
  it('rejects corrupted ciphertext',async()=>{
    const encrypted=await encrypt(env,'secret',context(env,'owner','google-sub'));
    const entry=JSON.parse(encrypted);entry.data=b64url(new Uint8Array(32));
    await assert.rejects(decrypt(env,JSON.stringify(entry),context(env,'owner','google-sub')));
  });
  it('rejects a tampered signed Google identity token',async()=>{
    const pair=await webcrypto.subtle.generateKey(
      {name:'RSASSA-PKCS1-v1_5',hash:'SHA-256',modulusLength:2048,publicExponent:new Uint8Array([1,0,1])},true,['sign','verify']);
    const key=await webcrypto.subtle.exportKey('jwk',pair.publicKey);key.kid='mockkey';
    const before=globalThis.fetch;
    globalThis.fetch=async()=>Response.json({keys:[key]});
    try {
      const now=Math.floor(Date.now()/1000);
      const header=b64url(new TextEncoder().encode(JSON.stringify({alg:'RS256',kid:'mockkey'})));
      const claims=b64url(new TextEncoder().encode(JSON.stringify({sub:'user',iss:'accounts.google.com',aud:'fake-client',iat:now,exp:now+60})));
      const signed=header+'.'+claims;
      const sig=b64url(new Uint8Array(await webcrypto.subtle.sign('RSASSA-PKCS1-v1_5',pair.privateKey,new TextEncoder().encode(signed))));
      assert.equal((await verifyJwt(signed+'.'+sig,'https://test.bem-feito.invalid/jwks','accounts.google.com','fake-client')).sub,'user');
      await assert.rejects(verifyJwt(signed+'.'+sig.slice(0,-1)+'A','https://test.bem-feito.invalid/jwks','accounts.google.com','fake-client'));
      await assert.rejects(verifyJwt(signed+'.'+sig,'https://test.bem-feito.invalid/jwks','accounts.google.com','wrong-client'));
    } finally {globalThis.fetch=before;}
  });
});
describe('Worker HTTP security',()=>{
  it('responds to health without exposing credentials',async()=>{
    const r=await worker.fetch(new Request('https://bem-feito-drive-dev.ewertonmendes9.workers.dev/health'),env);
    assert.equal(r.status,200);assert.equal((await r.json()).status,'ok');
    assert.equal(r.headers.get('Cache-Control'),'no-store');
    assert.equal(r.headers.get('X-Content-Type-Options'),'nosniff');
  });
  it('restricts CORS to the DEV frontend',async()=>{
    const denied=await worker.fetch(new Request('https://bem-feito-drive-dev.ewertonmendes9.workers.dev/health',
      {headers:{Origin:'https://malicious.invalid'}}),env);
    assert.equal(denied.status,403);
    assert.equal(denied.headers.has('Access-Control-Allow-Origin'),false);
    const preflight=await worker.fetch(new Request('https://bem-feito-drive-dev.ewertonmendes9.workers.dev/drive/token',
      {method:'OPTIONS',headers:{Origin:env.FRONTEND_ORIGIN}}),env);
    assert.equal(preflight.status,204);assert.equal(preflight.headers.get('Access-Control-Allow-Origin'),env.FRONTEND_ORIGIN);
  });
  it('rejects unauthenticated private endpoints',async()=>{
    const r=await worker.fetch(new Request('https://bem-feito-drive-dev.ewertonmendes9.workers.dev/drive/connection',
      {headers:{Origin:env.FRONTEND_ORIGIN}}),env);
    assert.equal(r.status,401);
    assert.equal((await r.json()).error.code,'authentication_required');
  });
  it('fails closed on accidental PROD bindings',async()=>{
    const r=await worker.fetch(new Request('https://bem-feito-drive-dev.ewertonmendes9.workers.dev/health'),{
      ...env,FIREBASE_PROJECT_ID:'a-prod-project'});
    assert.equal(r.status,503);
  });
});
