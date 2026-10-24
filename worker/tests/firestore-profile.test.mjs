import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { b64url } from '../src/crypto.ts';
import { principal, readVerifiedUserProfile } from '../src/auth.ts';

const env={FIREBASE_PROJECT_ID:'bem-feito-dev'};
const profile = {
  fields: {
    active:{booleanValue:true},
    role:{stringValue:'owner'},
    email:{stringValue:'user@example.invalid'}
  }
};
const firestorePrefix='https://firestore.googleapis.com/v1/projects/bem-feito-dev/databases/(default)/documents/users/';

describe('Firestore REST verification via Firebase ID tokens',()=>{
  it('honors user-scoped Firebase rules while fetching the authenticated profile',async()=>{
    const previous=globalThis.fetch;
    globalThis.fetch=async (url,init)=>{
      assert.equal(url,firestorePrefix+'test-user');
      assert.equal(init.redirect,'follow');
      assert.equal(init.headers.Authorization,'Bearer opaque-test-value');
      return Response.json(profile);
    };
    try {
      const role=await readVerifiedUserProfile(env,'opaque-test-value','test-user','user@example.invalid');
      assert.equal(role,'owner');
    }finally{globalThis.fetch=previous;}
  });

  it('preserves denial, inactive-user and email-mismatch checks',async()=>{
    const previous=globalThis.fetch;
    try {
      globalThis.fetch=async()=>Response.json({error:{code:403}},{status:403});
      await assert.rejects(readVerifiedUserProfile(env,'opaque','uid','user@example.invalid'),
        error=>error.status===403&&error.code==='user_not_authorized');

      globalThis.fetch=async()=>Response.json({...profile,fields:{...profile.fields,active:{booleanValue:false}}});
      await assert.rejects(readVerifiedUserProfile(env,'opaque','uid','user@example.invalid'),
        error=>error.status===403&&error.code==='user_not_authorized');

      globalThis.fetch=async()=>Response.json(profile);
      await assert.rejects(readVerifiedUserProfile(env,'opaque','uid','other@example.invalid'),
        error=>error.status===403&&error.code==='user_identity_mismatch');
    }finally{globalThis.fetch=previous;}
  });

  it('separates failures of transport, upstream status, and malformed payload',async()=>{
    const previous=globalThis.fetch;
    try{
      globalThis.fetch=async()=>{throw new TypeError('fetch failed: upstream details not for clients');};
      await assert.rejects(readVerifiedUserProfile(env,'opaque','uid','user@example.invalid'),
        error=>error.status===503&&error.code==='user_profile_transport'&&!error.message.includes('upstream details'));

      globalThis.fetch=async()=>new Response(null,{status:429});
      await assert.rejects(readVerifiedUserProfile(env,'opaque','uid','user@example.invalid'),
        error=>error.status===503&&error.code==='user_profile_upstream_429');

      globalThis.fetch=async()=>new Response('not JSON',{status:200});
      await assert.rejects(readVerifiedUserProfile(env,'opaque','uid','user@example.invalid'),
        error=>error.status===503&&error.code==='user_profile_invalid_response');
    }finally{globalThis.fetch=previous;}
  });

  it('validates the Firebase JWT signature and forwards the same ID token, not an admin credential',async()=>{
    const previous=globalThis.fetch;
    const pair=await webcrypto.subtle.generateKey(
      {name:'RSASSA-PKCS1-v1_5',hash:'SHA-256',modulusLength:2048,
        publicExponent:new Uint8Array([1,0,1])},true,['sign','verify']);
    const jwk=await webcrypto.subtle.exportKey('jwk',pair.publicKey);
    jwk.kid='firestore-test-key';
    const now=Math.floor(Date.now()/1000);
    const h=b64url(new TextEncoder().encode(JSON.stringify({alg:'RS256',kid:jwk.kid})));
    const p=b64url(new TextEncoder().encode(JSON.stringify({
      sub:'valid-test-user',aud:env.FIREBASE_PROJECT_ID,
      iss:'https://securetoken.google.com/'+env.FIREBASE_PROJECT_ID,
      exp:now+3600,iat:now-30,auth_time:now-60,
      email:'user@example.invalid',email_verified:true,
      firebase:{sign_in_provider:'google.com',identities:{'google.com':['verified-google-sub']}}
    })));
    const signed=h+'.'+p;
    const s=b64url(new Uint8Array(await webcrypto.subtle.sign(
      'RSASSA-PKCS1-v1_5',pair.privateKey,new TextEncoder().encode(signed))));
    const signedToken=signed+'.'+s;
    let keyRequests=0,profileRequests=0;
    globalThis.fetch=async(url,init)=>{
      if(String(url).includes('/service_accounts/v1/jwk/')){
        keyRequests++;return Response.json({keys:[jwk]});
      }
      assert.equal(url,firestorePrefix+'valid-test-user');
      assert.equal(init.headers.Authorization,'Bearer '+signedToken);
      assert.equal(init.redirect,'follow');
      profileRequests++;return Response.json(profile);
    };
    try{
      const result=await principal(new Request('https://worker.example.invalid/drive/token',{
        method:'POST',headers:{Authorization:'Bearer '+signedToken}
      }),env);
      assert.deepEqual(result,{
        uid:'valid-test-user',email:'user@example.invalid',googleSub:'verified-google-sub',role:'owner'
      });
      assert.equal(keyRequests,1);assert.equal(profileRequests,1);
    }finally{globalThis.fetch=previous;}
  });
});
