import { readFile } from 'node:fs/promises';
import { validateQueryPlan, validateRecipientKey } from './query-gateway.ts';
import { assertPermission, githubApi } from './gate.ts';
import { invariant, sha } from './schema.ts';

export async function authorizeQuery(
  event: any, env: NodeJS.ProcessEnv, config: any,
  api: (path: string) => Promise<any>,
) {
  invariant(env.GITHUB_ACTIONS === 'true' && !env.FIRESTORE_EMULATOR_HOST, 'Protected runner required');
  invariant(env.GITHUB_REPOSITORY === config.repository &&
    String(event.repository?.id) === config.repositoryId &&
    String(event.repository?.owner?.id) === config.ownerId, 'Repository identity mismatch');
  invariant(env.GITHUB_EVENT_NAME === 'workflow_dispatch' && event.inputs?.mode === 'query', 'Query dispatch required');
  invariant(env.GITHUB_REF === 'refs/heads/master' &&
    env.GITHUB_WORKFLOW_REF === config.repository + '/.github/workflows/data-admin.yml@refs/heads/master',
    'Protected trusted query executor required');
  sha(env.GITHUB_SHA);
  invariant(env.GITHUB_WORKFLOW_SHA === env.GITHUB_SHA && env.GITHUB_RUN_ATTEMPT === '1',
    'Only the original protected workflow execution is allowed');
  const actor = event.sender;
  invariant(actor?.type === 'User' && String(actor.id) === config.ownerId &&
    actor.login === env.GITHUB_ACTOR && actor.login === env.GITHUB_TRIGGERING_ACTOR,
    'Only the actual repository owner may dispatch a private query');
  invariant(env.GATEWAY_QUERY === event.inputs.query &&
    env.GATEWAY_KEY === event.inputs.recipient_public_key, 'Untrusted query parameters changed');
  invariant(Object.keys(event.inputs).every(k => ['mode','query','recipient_public_key','operation','pr','path','sha','request_hash','plan_hash','target_environment'].includes(k)) &&
    !['operation','pr','path','sha','request_hash','plan_hash'].some(k => Boolean(event.inputs[k])),
    'Query mode cannot invoke administration or submit PR parameters');
  const plan = validateQueryPlan(event.inputs.query);
  validateRecipientKey(event.inputs.recipient_public_key);
  const requestedEnvironment = event.inputs.target_environment || 'dev';
  invariant(requestedEnvironment === plan.environment, 'Selected query environment differs from request body');
  const target = config.environments[plan.environment];
  invariant(target && target.projectId === plan.projectId && target.databaseId === '(default)' &&
    target.provider && target.reader && target.writer &&
    target.archive?.projectId && target.archive.projectId !== target.projectId,
    'Configured query target is incomplete');
  if (plan.environment === 'prod') {
    invariant(target.projectId !== config.environments.dev.projectId &&
      target.archive.projectId !== config.environments.dev.archive.projectId &&
      target.reader !== config.environments.dev.reader &&
      target.writer !== config.environments.dev.writer,
      'PROD must use distinct project, identities and private archive');
  } else {
    invariant(target.reader === 'github-data-dev-read@bem-feito-dev.iam.gserviceaccount.com',
      'Configured DEV reader identity differs');
  }
  const branch = await api('branches/master');
  invariant(branch.protected === true && branch.commit.sha === env.GITHUB_SHA, 'Protected current master required');
  const ci = await api('actions/workflows/ci.yml/runs?head_sha=' + env.GITHUB_SHA + '&event=push&status=success&per_page=100');
  invariant(ci.workflow_runs?.some((run:any) => run.head_sha === env.GITHUB_SHA &&
    run.conclusion === 'success' && run.head_repository?.id === Number(config.repositoryId)),
    'Trusted master CI required');
  const permission = await api('collaborators/' + encodeURIComponent(actor.login) + '/permission');
  assertPermission(permission.permission);
  invariant(String(permission.user?.id) === String(actor.id), 'User identity differs');
  const environmentName = 'data-' + plan.environment + '-preview';
  const environment = await api('environments/' + environmentName);
  invariant(environment.deployment_branch_policy?.custom_branch_policies === true,
    'Protected query environment required');
  const policies = await api('environments/' + environmentName + '/deployment-branch-policies');
  invariant(policies.branch_policies?.length === 1 && policies.branch_policies[0].name === 'master' &&
    policies.branch_policies[0].type === 'branch', 'Query environment accepts an untrusted ref');
  return { plan };
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('/query-gate.ts')) {
  try {
    const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH!, 'utf8'));
    const config = JSON.parse(await readFile(new URL('./config.json', import.meta.url), 'utf8'));
    await authorizeQuery(event, process.env, config, p => githubApi(p, process.env.GH_TOKEN!));
    console.log('Query gate approved: master CI, owner identity, isolated read-only environment, bounded encrypted plan');
  } catch {
    console.error('Query authorization or limits rejected; no Firestore credentials were obtained');
    process.exitCode = 1;
  }
}
