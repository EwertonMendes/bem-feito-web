import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { authorizeQuery } from './query-gate.ts';

test('query dispatch requires authenticated owner and protected master', async () => {
  const config=JSON.parse(await readFile(new URL('./config.json',import.meta.url),'utf8'));
  const sha='a'.repeat(40);
  const actor={id:33728924,login:'EwertonMendes',type:'User'};
  const event:any={repository:{id:1406056807,owner:{id:33728924}},sender:actor,inputs:{
    mode:'query',
    query:JSON.stringify({schemaVersion:1,environment:'dev',projectId:'bem-feito-dev',queries:[
      {name:'p',collection:'productions',filters:[{field:'businessDate',op:'==',value:'2026-10-10'}],limit:5}
    ]}),
    recipient_public_key:''}};
  const {generateKeyPairSync}=await import('node:crypto');
  event.inputs.recipient_public_key=generateKeyPairSync('rsa',{modulusLength:3072}).publicKey.export({format:'der',type:'spki'}).toString('base64url');
  const env:any={GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:config.repository,GITHUB_REF:'refs/heads/master',
    GITHUB_WORKFLOW_REF:config.repository+'/.github/workflows/data-admin.yml@refs/heads/master',
    GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_SHA:sha,GITHUB_WORKFLOW_SHA:sha,GITHUB_RUN_ATTEMPT:'1',
    GITHUB_ACTOR:actor.login,GITHUB_TRIGGERING_ACTOR:actor.login,GATEWAY_QUERY:event.inputs.query,
    GATEWAY_KEY:event.inputs.recipient_public_key};
  const api=async (path:string):Promise<any>=>{
    if(path==='branches/master')return{protected:true,commit:{sha}};
    if(path.startsWith('actions/workflows/ci.yml'))return{workflow_runs:[{head_sha:sha,conclusion:'success',head_repository:{id:1406056807}}]};
    if(path.startsWith('collaborators/'))return{permission:'admin',user:actor};
    if(path==='environments/data-dev-preview')return{deployment_branch_policy:{custom_branch_policies:true}};
    if(path.endsWith('/deployment-branch-policies'))return{branch_policies:[{name:'master',type:'branch'}]};
    throw Error('Unexpected authorization read');
  };
  assert.ok((await authorizeQuery(event,env,config,api)).plan);
  await assert.rejects(authorizeQuery(event,{...env,GITHUB_REF:'refs/heads/feature'},config,api));
  await assert.rejects(authorizeQuery(event,{...env,GATEWAY_QUERY:'different'},config,api));
  await assert.rejects(authorizeQuery({...event,sender:{...actor,id:1}},env,config,api));
  await assert.rejects(authorizeQuery({...event,inputs:{...event.inputs,pr:'10'}},env,config,api));
  await assert.rejects(authorizeQuery({...event,inputs:{...event.inputs,operation:'bad'}},env,config,api));
  assert.ok((await authorizeQuery({...event,inputs:{...event.inputs,operation:''}},env,config,api)).plan);
  await assert.rejects(authorizeQuery(event,env,config,async p=>p==='branches/master'?{protected:false,commit:{sha}}:api(p)));
});
