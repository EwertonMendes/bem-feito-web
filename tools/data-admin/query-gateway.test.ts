import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, privateDecrypt, createDecipheriv, constants } from 'node:crypto';
import { validateQueryPlan, validateRecipientKey, encryptResult } from './query-gateway.ts';

const basic = {schemaVersion:1,environment:'dev',projectId:'bem-feito-dev',queries:[
  {name:'batch',collection:'productions',filters:[{field:'businessDate',op:'==',value:'2026-10-10'}],limit:10}
]};
test('query restrictions prevent broad or unauthorized requests', () => {
  assert.equal(validateQueryPlan(JSON.stringify(basic)).queries.length,1);
  for (const p of [
    {...basic,projectId:'other-project'},
    {...basic,queries:[{...basic.queries[0],limit:1000}]},
    {...basic,queries:[{...basic.queries[0],filters:[]}]},
    {...basic,queries:[{...basic.queries[0],collection:'users'}]},
  ]) assert.throws(()=>validateQueryPlan(JSON.stringify(p)));
});
test('result encryption uses authenticated RSA and AES and hides its plaintext', () => {
  const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:3072,publicExponent:65537});
  const spki=publicKey.export({format:'der',type:'spki'}).toString('base64url');
  const request=JSON.stringify(basic), plain=JSON.stringify({revenueCents:12796});
  const packet=encryptResult(plain,validateRecipientKey(spki),request);
  assert.ok(!packet.includes('revenueCents'));
  const envelope=JSON.parse(Buffer.from(packet,'base64url').toString());
  const key=privateDecrypt({key:privateKey,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},Buffer.from(envelope.key,'base64url'));
  const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(envelope.iv,'base64url'));
  decipher.setAAD(Buffer.from(envelope.queryHash,'hex'));
  decipher.setAuthTag(Buffer.from(envelope.tag,'base64url'));
  const result=Buffer.concat([decipher.update(Buffer.from(envelope.data,'base64url')),decipher.final()]).toString();
  assert.equal(result,plain);
});
