import { readFile, writeFile, mkdir, appendFile } from 'node:fs/promises';
import { validateRequest, assertDestination, invariant, sha, digest, requestHash } from './schema.ts';
import type { Request } from './schema.ts';

export type Command = { mode: 'preview' | 'apply'; path: string; sha: string; hash?: string; plan?: string };
export function parseCommand(body: string): Command {
  const match = /^\/data-admin (preview|apply) (operations\/requests\/[a-z0-9][a-z0-9-]{0,79}\.json) ([a-f0-9]{40})(?: ([a-f0-9]{64}) ([a-f0-9]{64}))?$/.exec(body.trim());
  invariant(match, 'Invalid command: immutable SHA and canonical request path required');
  invariant(match[1] === 'apply' ? !!match[4] && !!match[5] : !match[4], 'Apply requires request and plan hashes');
  return { mode: match[1] as Command['mode'], path: match[2], sha: match[3], ...(match[4] ? { hash: match[4], plan: match[5] } : {}) };
}
export function assertPermission(permission: string) {
  invariant(['write', 'maintain', 'admin'].includes(permission), 'Requester has no repository write permission');
}
export function assertPull(pull: any, config: any, commit: string) {
  invariant(pull.state === 'open' && pull.base.ref === config.branch, 'Open PR against protected master required');
  invariant(String(pull.head.repo?.id) === config.repositoryId && pull.head.repo?.full_name === config.repository && pull.head.sha === commit, 'Forks and stale/request SHA mismatch rejected');
}
export async function githubApi(path: string, token: string): Promise<any> {
  const response = await fetch(`https://api.github.com/repos/EwertonMendes/bem-feito-web/${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' } });
  invariant(response.ok, `GitHub authorization API failed: HTTP ${response.status}`); return response.json();
}
export async function authorize(event: any, env: NodeJS.ProcessEnv, config: any, api: (path: string) => Promise<any>) {
  invariant(env.GITHUB_REPOSITORY === config.repository && String(event.repository?.id) === config.repositoryId && String(event.repository?.owner?.id) === config.ownerId, 'Repository identity mismatch');
  invariant(env.GITHUB_REF === 'refs/heads/master' && env.GITHUB_WORKFLOW_REF === `${config.repository}/.github/workflows/${config.workflow}@refs/heads/master`, 'Trusted workflow on master required');
  invariant(env.GITHUB_RUN_ATTEMPT === '1', 'Reruns are denied; submit a new authorized command');
  sha(env.GITHUB_SHA); invariant(env.GITHUB_WORKFLOW_SHA === env.GITHUB_SHA, 'Workflow/executor commit differs');
  const branch = await api('branches/master');
  invariant(branch.protected === true && branch.commit.sha === env.GITHUB_SHA, 'Protected current master required');
  const executorCi = await api(`actions/workflows/ci.yml/runs?head_sha=${env.GITHUB_SHA}&event=push&status=success&per_page=100`);
  invariant(executorCi.workflow_runs?.some((run: any) => run.head_sha === env.GITHUB_SHA && run.conclusion === 'success' && run.head_repository?.id === Number(config.repositoryId)), 'Exact trusted master CI must pass before credentials');
  let command: Command; let actor: any; let pr: number; let commentId = '';
  if (env.GITHUB_EVENT_NAME === 'issue_comment') {
    invariant(event.action === 'created' && event.issue?.pull_request, 'Only newly created PR comments accepted');
    const current = await api(`issues/comments/${event.comment.id}`);
    invariant(current.body === event.comment.body && current.user.id === event.comment.user.id, 'Edited/delegated comment differs from event');
    invariant(current.user.type === 'User' && event.sender.id === current.user.id && env.GITHUB_ACTOR === current.user.login && env.GITHUB_TRIGGERING_ACTOR === current.user.login, 'Real requester identity differs');
    command = parseCommand(current.body); actor = current.user; pr = event.issue.number; commentId = String(current.id);
  } else {
    invariant(env.GITHUB_EVENT_NAME === 'workflow_dispatch', 'Event origin not allowed');
    actor = event.sender;
    invariant(actor?.type === 'User' && env.GITHUB_ACTOR === actor.login && env.GITHUB_TRIGGERING_ACTOR === actor.login, 'Dispatch requester differs');
    command = parseCommand(`/data-admin ${event.inputs.mode} ${event.inputs.path} ${event.inputs.sha}${event.inputs.mode === 'apply' ? ` ${event.inputs.request_hash} ${event.inputs.plan_hash}` : ''}`);
    pr = Number(event.inputs.pr); invariant(Number.isSafeInteger(pr) && pr > 0, 'Invalid request PR');
  }
  const permission = await api(`collaborators/${encodeURIComponent(actor.login)}/permission`);
  assertPermission(permission.permission);
  invariant(String(permission.user?.id) === String(actor.id), 'Permission principal differs');
  const pull = await api(`pulls/${pr}`); assertPull(pull, config, command.sha);
  // Fetch ONLY one JSON file via API. Never checkout or execute request PR code.
  const file = await api(`contents/${command.path}?ref=${command.sha}`);
  invariant(file.type === 'file' && file.encoding === 'base64' && file.size > 0 && file.size <= 65536 && file.path === command.path, 'Invalid request blob');
  const request = validateRequest(JSON.parse(Buffer.from(file.content.replace(/\s/g, ''), 'base64').toString('utf8')));
  const destination = assertDestination(request, config);
  const computedHash = requestHash(request);
  if (command.mode === 'apply') {
    digest(command.hash); digest(command.plan); invariant(command.hash === computedHash, 'Approved request hash differs');
    invariant(!['read', 'inspect', 'verify'].includes(request.operation), 'Read-only operation cannot apply');
  }
  const phase = command.mode === 'preview' ? 'preview' : 'execute';
  const environment = `data-${request.environment}-${phase}`;
  const protection = await api(`environments/${environment}`);
  invariant(protection.deployment_branch_policy?.custom_branch_policies === true, 'Environment branch restriction missing');
  const policies = await api(`environments/${environment}/deployment-branch-policies`);
  invariant(policies.branch_policies?.length === 1 && policies.branch_policies[0].name === 'master' && policies.branch_policies[0].type === 'branch', 'Environment allows untrusted branches/tags');
  if (request.environment === 'prod' && command.mode === 'apply') {
    invariant(env.GITHUB_EVENT_NAME === 'workflow_dispatch', 'PROD apply requires human dispatch and environment approval');
    invariant(String(actor.id) === config.ownerId && config.productionApprovers.includes(config.ownerId), 'PROD requires the repository owner to authorize this exact plan');
    const reviewers = protection.protection_rules?.find((r: any) => r.type === 'required_reviewers');
    invariant(reviewers?.prevent_self_review === false && reviewers.reviewers?.length === 1 && protection.can_admins_bypass === false, 'PROD owner approval/no-bypass protection missing');
    invariant(reviewers.reviewers[0].type === 'User' && String(reviewers.reviewers[0].reviewer.id) === config.ownerId, 'PROD environment must require the repository owner');
  }
  if (request.operation === 'migrate') {
    const evolution = await api('pulls/28');
    invariant(evolution.state === 'open' && !evolution.merged && String(evolution.head.repo?.id) === config.repositoryId && evolution.head.sha === request.deploymentSha, 'PR #28 migration application SHA differs');
    const ci = await api(`actions/workflows/ci.yml/runs?head_sha=${request.deploymentSha}&event=push&status=success&per_page=100`);
    invariant(ci.workflow_runs?.some((run: any) => run.head_sha === request.deploymentSha && run.conclusion === 'success' && run.head_repository?.id === Number(config.repositoryId)), 'Exact PR #28 CI must pass');
  }
  return { command, request, destination, environment, pr, actor: { login: actor.login, id: String(actor.id), requestSha: command.sha, trustedSha: env.GITHUB_SHA, runId: env.GITHUB_RUN_ID!, commentId, ...(command.plan ? { approvedPlan: command.plan } : {}) } };
}
if (process.argv[1]?.replace(/\\/g, '/').endsWith('/gate.ts')) {
  try {
    const config = JSON.parse(await readFile(new URL('./config.json', import.meta.url), 'utf8'));
    const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH!, 'utf8'));
    const authorized = await authorize(event, process.env, config, path => githubApi(path, process.env.GH_TOKEN!));
    await mkdir('tools/data-admin/.private', { recursive: true });
    await writeFile('tools/data-admin/.private/authorized.json', JSON.stringify(authorized), { mode: 0o600 });
    const outputs = { mode: authorized.command.mode, environment: authorized.environment, target: authorized.request.environment, project: authorized.destination.projectId, provider: authorized.destination.provider, account: authorized.command.mode === 'preview' ? authorized.destination.reader : authorized.destination.writer, migration: String(authorized.request.operation === 'migrate'), deployment_sha: authorized.request.deploymentSha ?? '', request_hash: requestHash(authorized.request), plan_hash: authorized.command.plan ?? '' };
    await appendFile(process.env.GITHUB_OUTPUT!, Object.entries(outputs).map(([k, v]) => `${k}=${v}\n`).join(''));
  } catch (error) { console.error(error instanceof Error ? error.message : 'Authorization denied'); process.exitCode = 1; }
}
