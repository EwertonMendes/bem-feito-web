import { readFile } from 'node:fs/promises';
import { validateDirectRequest } from './direct-gateway.ts';
import { assertPermission, githubApi } from './gate.ts';
import { invariant, sha } from './schema.ts';

/** No PRs or writeable request files: owner dispatches validated JSON to trusted master. */
export async function authorizeDirect(event: any, env: NodeJS.ProcessEnv, config: any,
  api:(path:string)=>Promise<any>) {
  invariant(env.GITHUB_ACTIONS === 'true' && !env.FIRESTORE_EMULATOR_HOST, 'Protected runner required');
  invariant(env.GITHUB_REPOSITORY === config.repository &&
    String(event.repository?.id) === config.repositoryId &&
    String(event.repository?.owner?.id) === config.ownerId, 'Repository identity mismatch');
  invariant(env.GITHUB_EVENT_NAME === 'workflow_dispatch' && event.inputs?.mode === 'direct',
    'Direct workflow_dispatch required');
  invariant(env.GITHUB_REF === 'refs/heads/master' &&
    env.GITHUB_WORKFLOW_REF === config.repository+'/.github/workflows/data-admin.yml@refs/heads/master',
    'Protected master workflow required');
  sha(env.GITHUB_SHA);
  invariant(env.GITHUB_WORKFLOW_SHA === env.GITHUB_SHA && env.GITHUB_RUN_ATTEMPT === '1',
    'Original protected master execution required');
  const actor=event.sender;
  invariant(actor?.type === 'User' && String(actor.id) === config.ownerId &&
    actor.login === env.GITHUB_ACTOR && actor.login === env.GITHUB_TRIGGERING_ACTOR,
    'Owner identity required for direct writes');
  invariant(env.GATEWAY_DIRECT === event.inputs.operation, 'Dispatch parameters changed');
  invariant(Object.keys(event.inputs).every(k =>
    ['mode','operation','recipient_public_key','pr','path','sha','request_hash','plan_hash','query'].includes(k)) &&
    !['pr','path','sha','request_hash','plan_hash','query','recipient_public_key']
      .some(k => Boolean(event.inputs[k])), 'Direct cannot mix query or PR inputs');
  const request=validateDirectRequest(event.inputs.operation);
  invariant(config.environments.dev?.projectId === request.projectId &&
    config.environments.dev?.writer === 'github-data-dev@bem-feito-dev.iam.gserviceaccount.com',
    'DEV writer configuration changed');
  const master=await api('branches/master');
  invariant(master.protected === true && master.commit.sha === env.GITHUB_SHA,
    'Protected current master required');
  const ci=await api('actions/workflows/ci.yml/runs?head_sha='+env.GITHUB_SHA+'&event=push&status=success&per_page=100');
  invariant(ci.workflow_runs?.some((r:any)=>r.head_sha === env.GITHUB_SHA &&
    r.conclusion === 'success' && r.head_repository?.id === Number(config.repositoryId)),
    'Trusted master CI required');
  const permission=await api('collaborators/'+encodeURIComponent(actor.login)+'/permission');
  assertPermission(permission.permission);
  invariant(String(permission.user?.id) === String(actor.id), 'Requester identity differs');
  const environment=await api('environments/data-dev-execute');
  invariant(environment.deployment_branch_policy?.custom_branch_policies === true,
    'Protected execute environment required');
  const policies=await api('environments/data-dev-execute/deployment-branch-policies');
  invariant(policies.branch_policies?.length === 1 && policies.branch_policies[0].name === 'master' &&
    policies.branch_policies[0].type === 'branch', 'Execute environment accepts untrusted branches');
  return {request,owner:actor.login,ownerId:String(actor.id)};
}
if (process.argv[1]?.replace(/\\/g,'/').endsWith('/direct-gate.ts')) {
  try {
    const event=JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH!,'utf8'));
    const config=JSON.parse(await readFile(new URL('./config.json',import.meta.url),'utf8'));
    await authorizeDirect(event,process.env,config,p=>githubApi(p,process.env.GH_TOKEN!));
    console.log('Owner-only direct DEV request authorized; no PR or write token exposed.');
  } catch {
    // Validation failures may include secrets from GitHub; never echo untrusted input.
    console.error('Direct authorization failed safely.');
    process.exitCode=1;
  }
}
