import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { encrypt, context, b64url } from '../src/crypto.ts';
import { imageRequest, storageStatus } from '../src/image-storage.ts';

const owner={uid:'ewerton-uid',email:'ewertonmendes9@gmail.com',googleSub:'ewerton-google-sub',role:'owner'};
const maria={uid:'maria-uid',email:'mariaeevieira@gmail.com',googleSub:'maria-google-sub',role:'owner'};
const viewer={...maria,role:'viewer'};
const ids={root:'root-id',products:'products-folder',inputs:'inputs-folder',additions:'additions-folder'};
const imageId='image-id',entityId='product-123';
const fields=(items)=>({mapValue:{fields:items}});
const string=(s)=>({stringValue:s});
const integration={fields:{
  enabled:{booleanValue:true},rootFolderId:string(ids.root),
  folders:fields({products:string(ids.products),inputs:string(ids.inputs),additions:string(ids.additions)})
}};
const product={fields:{image:fields({fileId:string(imageId),provider:string('google-drive')})}};
const sample=Uint8Array.from([82,73,70,70,16,0,0,0,87,69,66,80,86,80,56,32,1,2,3,4]);
async function fixture(){
  const env={
    ENVIRONMENT:'dev',FIREBASE_PROJECT_ID:'bem-feito-dev',STORAGE_OWNER_EMAIL:owner.email,
    GOOGLE_CLIENT_ID:'test',GOOGLE_CLIENT_SECRET:'',TOKEN_KEY_VERSION:'v1',
    TOKEN_KEYS:JSON.stringify({v1:b64url(randomBytes(32))}),
  };
  const value={
    owner_uid:owner.uid,google_subject:owner.googleSub,google_email:owner.email,status:'connected',
    encrypted_refresh_token:['fixture','unused'].join('-'),
    encrypted_access_token:await encrypt(env,'secret-owner-access-token',context(env,owner.uid,owner.googleSub,'access:1:cached-token')),
    access_token_expires_at:Date.now()+3600_000,access_token_version:'cached-token',revision:1,
    refresh_retry_after:0,refresh_lease_until:0,
  };
  env.DB={
    prepare(sql){
      return {bind(...args){
        return {
          async all(){
            assert.match(sql,/google_email/);
            return {results:args[0]===owner.email?[value]:[]};
          },
          async first(){
            assert.match(sql,/owner_uid/);
            return args[0]===owner.uid?value:null;
          },
          async run(){throw Error('unexpected D1 mutation');}
        };
      }};
    },
  };
  return env;
}
function driveMetadata(overrides={}){
  return {
    id:imageId,mimeType:'image/webp',trashed:false,parents:[ids.products],size:String(sample.length),
    appProperties:{app:'bem-feito',entityType:'products',entityId},...overrides
  };
}
function setupGoogle(metadata=driveMetadata(), options={}){
  const requests=[];
  const old=globalThis.fetch;
  globalThis.fetch=async(url,init={})=>{
    const address=String(url);requests.push({address,init});
    if(address.includes('firestore.googleapis.com')){
      assert.equal(init.headers.Authorization,'Bearer firebase-id-token');
      if(address.endsWith('/integrations/google-drive')) return Response.json(integration);
      if(address.endsWith('/products/'+entityId)) return Response.json(options.reference??product);
      throw Error('Unexpected Firestore document: '+address);
    }
    if(address.includes('www.googleapis.com/drive/v3')){
      assert.equal(new Headers(init.headers).get('Authorization'),'Bearer secret-owner-access-token');
      if(init.method==='POST') return Response.json({id:'created-image-123',mimeType:'image/webp'});
      if(init.method==='PATCH')return Response.json({...metadata,id:address.includes('created-image')?'created-image-123':imageId});
      if(address.includes('alt=media'))return new Response(sample,{headers:{'Content-Type':'image/webp'}});
      return Response.json(metadata);
    }
    throw Error('Unexpected external URL '+address);
  };
  return {requests,restore:()=>{globalThis.fetch=old;}};
}
function req(method,path,bytes){
  return new Request('https://worker.example.invalid'+path,{
    method,headers:{Authorization:'Bearer firebase-id-token',...(bytes?{'Content-Type':'image/webp'}:{})},
    ...(bytes?{body:bytes}:{})
  });
}
describe('shared image storage authorization boundaries',()=>{
  it('allows Maria to read Ewerton-owned managed image without disclosing the owner token',async()=>{
    const env=await fixture(),mock=setupGoogle();
    try{
      assert.deepEqual(await (await storageStatus(env,maria)).json(),{available:true,ownerEmail:owner.email});
      const response=await imageRequest(req('GET','/storage/image/'+imageId),env,maria);
      assert.equal(response.status,200);
      assert.equal(response.headers.get('Content-Type'),'image/webp');
      assert.equal(response.headers.get('Cache-Control'),'no-store');
      assert.deepEqual(new Uint8Array(await response.arrayBuffer()),sample);
      assert.ok(mock.requests.every(call=>!call.address.includes('secret-owner-access-token')));
    }finally{mock.restore();}
  });
  it('rejects another folder even when Google Drive exposes the file',async()=>{
    const env=await fixture(),mock=setupGoogle(driveMetadata({parents:['private-personal-folder']}));
    try{
      await assert.rejects(imageRequest(req('GET','/storage/image/'+imageId),env,maria),
        error=>error.code==='storage_image_outside_catalog');
    }finally{mock.restore();}
  });
  it('rejects viewer writes before looking up Google bearer credentials',async()=>{
    const env=await fixture(),mock=setupGoogle();
    try{
      await assert.rejects(imageRequest(req('DELETE','/storage/image/'+imageId+'?kind=products&entityId='+entityId),env,viewer),
        error=>error.code==='image_write_forbidden');
      assert.equal(mock.requests.length,0);
    }finally{mock.restore();}
  });
  it('rejects unrelated Firestore image refs before update or trash',async()=>{
    const env=await fixture(),mock=setupGoogle(driveMetadata(),{
      reference:{fields:{image:fields({fileId:string('other-id'),provider:string('google-drive')})}}
    });
    try{
      await assert.rejects(imageRequest(req('DELETE','/storage/image/'+imageId+'?kind=products&entityId='+entityId),env,maria),
        error=>error.code==='storage_image_reference_mismatch');
      assert.equal(mock.requests.filter(r=>r.address.includes('www.googleapis.com')).length,0);
    }finally{mock.restore();}
  });
  it('uploads images with the storage owner identity, approved folder and entity scope',async()=>{
    const env=await fixture(),mock=setupGoogle();
    try{
      const response=await imageRequest(req('POST','/storage/image?kind=products&entityId='+entityId,sample),env,maria);
      assert.equal(response.status,200);
      const create=mock.requests.find(x=>x.init.method==='POST');
      assert.ok(create);
      const body=JSON.parse(create.init.body);
      assert.deepEqual(body.parents,[ids.products]);
      assert.deepEqual(body.appProperties,{app:'bem-feito',entityType:'products',entityId});
      assert.ok(mock.requests.some(x=>x.init.method==='PATCH' && x.address.includes('created-image-123')));
    }finally{mock.restore();}
  });
  it('rejects fake WebP content and malformed kind without writing to Drive',async()=>{
    const env=await fixture(),mock=setupGoogle();
    try{
      await assert.rejects(imageRequest(req('POST','/storage/image?kind=products&entityId='+entityId,
        new Uint8Array([60,104,116,109,108,62])),env,maria),
        error=>error.code==='invalid_image_type');
      await assert.rejects(imageRequest(req('POST','/storage/image?kind=../../secrets&entityId='+entityId,
        sample),env,maria),error=>error.code==='invalid_image_kind');
      assert.equal(mock.requests.filter(r=>r.address.includes('www.googleapis.com')).length,0);
    }finally{mock.restore();}
  });
  it('does not accept another Drive owner's account in central storage',async()=>{
    const env=await fixture();
    env.STORAGE_OWNER_EMAIL='somebody-else@example.com';
    const result=await (await storageStatus(env,maria)).json();
    assert.equal(result.available,false);
  });
});
