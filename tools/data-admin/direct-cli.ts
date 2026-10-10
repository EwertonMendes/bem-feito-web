import { readFile } from 'node:fs/promises';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { authorizeDirect } from './direct-gate.ts';
import { directAsRequest, prepareDirect } from './direct-gateway.ts';
import { FirestoreArchive } from './storage.ts';
import { apply, type Actor, type Plan } from './engine.ts';
import { hash, invariant, requestHash } from './schema.ts';
import { githubApi } from './gate.ts';

try {
  const event=JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH!,'utf8'));
  const config=JSON.parse(await readFile(new URL('./config.json',import.meta.url),'utf8'));
  // Run the exact same trusted gate again after OIDC; never trust an earlier step alone.
  const {request:input,owner,ownerId}=await authorizeDirect(event,process.env,config,
    p=>githubApi(p,process.env.GH_TOKEN!));
  const credential=applicationDefault();
  const app=initializeApp({credential,projectId:'bem-feito-dev'});
  const db=getFirestore(app,'(default)');
  invariant(config.environments.dev.archive.projectId === 'bem-feito-archive-dev',
    'Independent archive required');
  const archiveApp=initializeApp({credential:applicationDefault(),projectId:'bem-feito-archive-dev'},'direct-archive');
  const archive=new FirestoreArchive(getFirestore(archiveApp,'(default)'));
  await archive.assertAccess({runId:process.env.GITHUB_RUN_ID!,phase:'execute'});
  const request=directAsRequest(input), requestDigest=requestHash(request);
  const receipt=await db.doc('dataAdminOperations/'+input.id).get();
  let plan:Plan;
  if (receipt.exists) {
    invariant(receipt.data()?.requestHash === requestDigest && receipt.data()?.status === 'complete',
      'Existing operation differs; manual review required');
    plan=await archive.get('plans',receipt.data()?.planHash) as Plan;
  } else {
    ({plan}=await prepareDirect(input,db));
    await archive.put('plans',plan);
  }
  const actor:Actor={login:owner,id:ownerId,requestSha:process.env.GITHUB_SHA!,
    trustedSha:process.env.GITHUB_SHA!,runId:process.env.GITHUB_RUN_ID!,commentId:'',
    approvedPlan:hash(plan)};
  const result=await apply(request,plan,db,archive,actor);
  // Only metadata leaves the runner. No document fields or customer information in logs.
  console.log(JSON.stringify({schemaVersion:1,projectId:'bem-feito-dev',
    action:input.action,operationId:input.id,status:result.status,
    validation:result.validation ?? 'replay-verified',documents:result.documents,
    backup:result.backup}));
} catch {
  console.error('Direct operation failed without business data output; review authorization, data preconditions and audit.');
  process.exitCode=1;
}
