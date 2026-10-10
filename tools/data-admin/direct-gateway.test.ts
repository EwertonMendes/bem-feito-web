import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { validateDirectRequest } from './direct-gateway.ts';
import { authorizeDirect } from './direct-gate.ts';
const json=(value:any)=>JSON.stringify(value);
const base={schemaVersion:1,id:'change-20261010-1',environment:'dev',projectId:'bem-feito-dev'};
const patch={...base,action:'patch',collection:'products',documentId:'PROD-041',
  expected:{salePriceCents:1500},values:{salePriceCents:1600}};
test('direct gateway accepts reusable safe requests, never hard-coded production IDs',()=>{
  assert.equal(validateDirectRequest(json(patch)).documentId,'PROD-041');
  assert.equal(validateDirectRequest(json({...base,action:'reverseProduction',documentId:'any-production-id'})).action,'reverseProduction');
  assert.equal(validateDirectRequest(json({...base,action:'adjustStock',itemType:'product',itemId:'p-any',quantityDelta:-1,
    reason:'Physical count',businessDate:'2026-10-10'})).action,'adjustStock');
  assert.equal(validateDirectRequest(json({...base,action:'create',collection:'collections',
    documentId:'my-collection',values:{name:'New collection',active:true}})).action,'create');
  assert.equal(validateDirectRequest(json({...base,action:'delete',collection:'dataAdminSmoke',
    documentId:'smoke-direct'})).action,'delete');
});
test('direct rejects PII, arbitrary script, raw core writes, overbroad operations and unrelated projects',()=>{
  for(const p of [
    {...patch,environment:'prod'}, {...patch,projectId:'another-project'},
    {...patch,values:{stock:300},expected:{stock:0}},
    {...patch,values:{salePriceCents:-1}},
    {...patch,values:{salePriceCents:1600},expected:{salePriceCents:1000,stock:1}},
    {...patch,values:{salePriceCents:1600},expected:{salePriceCents:1500},script:'eval()'},
    {...patch,documentId:'../users/admin'},
    {...patch,values:{customerName:'private'},expected:{customerName:'private'}},
    {...base,action:'delete',collection:'sales',documentId:'any-sale'},
    {...base,action:'reverseProduction',documentId:'production/invalid'},
    {...base,action:'create',collection:'productions',documentId:'p1',values:{quantity:300}},
    {...base,action:'adjustStock',itemType:'product',itemId:'p1',quantityDelta:0,reason:'x',businessDate:'2026-10-10'},
  ]) assert.throws(()=>validateDirectRequest(json(p)));
});
test('direct authorization requires trusted owner, master and exact dispatch',async()=>{
  const config=JSON.parse(await readFile(new URL('./config.json',import.meta.url),'utf8'));
  const sha='a'.repeat(40);
  const actor={id:33728924,login:'EwertonMendes',type:'User'};
  const event:any={repository:{id:1406056807,owner:{id:33728924}},sender:actor,
    inputs:{mode:'direct',operation:json(patch)}};
  const env:any={GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:config.repository,GITHUB_REF:'refs/heads/master',
    GITHUB_WORKFLOW_REF:config.repository+'/.github/workflows/data-admin.yml@refs/heads/master',
    GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_SHA:sha,GITHUB_WORKFLOW_SHA:sha,GITHUB_RUN_ATTEMPT:'1',
    GITHUB_ACTOR:actor.login,GITHUB_TRIGGERING_ACTOR:actor.login,GATEWAY_DIRECT:event.inputs.operation};
  const api=async(path:string):Promise<any>=>{
    if(path==='branches/master')return {protected:true,commit:{sha}};
    if(path.startsWith('actions/workflows/ci.yml'))return {workflow_runs:[{head_sha:sha,conclusion:'success',head_repository:{id:1406056807}}]};
    if(path.startsWith('collaborators/'))return {permission:'admin',user:actor};
    if(path==='environments/data-dev-execute')return {deployment_branch_policy:{custom_branch_policies:true}};
    if(path.endsWith('/deployment-branch-policies'))return {branch_policies:[{name:'master',type:'branch'}]};
    throw Error('Unexpected authorization read');
  };
  assert.equal((await authorizeDirect(event,env,config,api)).request.action,'patch');
  await assert.rejects(authorizeDirect(event,{...env,GITHUB_REF:'refs/heads/untrusted'},config,api));
  await assert.rejects(authorizeDirect(event,{...env,GATEWAY_DIRECT:'tampered'},config,api));
  await assert.rejects(authorizeDirect({...event,sender:{...actor,id:2}},env,config,api));
  await assert.rejects(authorizeDirect({...event,inputs:{...event.inputs,pr:'12'}},env,config,api));
  await assert.rejects(authorizeDirect(event,env,config,async p=>p==='branches/master'?{protected:false,commit:{sha}}:api(p)));
});
