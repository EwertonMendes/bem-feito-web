// Trust gate executed both before and AFTER the protected GitHub Environment approval.
// Do not move any of these checks to an untrusted pull request context.
const env = process.env;
const repo = 'EwertonMendes/bem-feito-web';
const allowedWorkflows = new Set(['deploy-prod.yml', 'deploy-drive-worker-prod.yml']);
const fail = (reason) => { throw new Error('PROD release denied: ' + reason); };
const sha = env.RELEASE_SHA?.trim();
if (env.GITHUB_ACTIONS !== 'true' || env.GITHUB_EVENT_NAME !== 'workflow_dispatch' ||
    env.GITHUB_REF !== 'refs/heads/master' || env.GITHUB_REPOSITORY !== repo ||
    env.GITHUB_REPOSITORY_ID !== '1406056807' ||
    env.GITHUB_REPOSITORY_OWNER_ID !== '33728924' ||
    env.GITHUB_ACTOR !== 'EwertonMendes' ||
    env.GITHUB_TRIGGERING_ACTOR !== 'EwertonMendes' ||
    env.GITHUB_RUN_ATTEMPT !== '1' || !/^[a-f0-9]{40}$/.test(sha ?? '') ||
    !env.GH_TOKEN) fail('untrusted dispatcher, repository, revision or actor');

const workflow = (env.GITHUB_WORKFLOW_REF ?? '').split('/.github/workflows/')[1];
if (!workflow || !workflow.endsWith('@refs/heads/master') ||
    !allowedWorkflows.has(workflow.split('@')[0]) ||
    env.GITHUB_WORKFLOW_SHA !== env.GITHUB_SHA) fail('workflow must execute unchanged from protected master');

async function github(path) {
  const response = await fetch('https://api.github.com/repos/' + repo + '/' + path, {
    headers: {
      Authorization: 'Bearer ' + env.GH_TOKEN,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) fail('GitHub trust API returned ' + response.status);
  return response.json();
}
const master = await github('branches/master');
if (!master.protected || master.commit?.sha !== sha || env.GITHUB_SHA !== sha) {
  fail('release must be the current protected master commit');
}
// GitHub creates an unprotected Environment if it does not exist. Reject that state
// before any PROD token, Cloudflare upload or federated credential can be used.
const protection = await github('environments/prod');
if (protection.deployment_branch_policy?.custom_branch_policies !== true ||
    protection.can_admins_bypass !== false) {
  fail('PROD Environment must restrict branch and disable administrative approval bypass');
}
const policies = await github('environments/prod/deployment-branch-policies');
if (policies.branch_policies?.length !== 1 ||
    policies.branch_policies[0].name !== 'master' ||
    policies.branch_policies[0].type !== 'branch') {
  fail('PROD Environment branch allowlist must contain only master');
}
const rule = protection.protection_rules?.find(item => item.type === 'required_reviewers');
if (!rule || rule.prevent_self_review !== false || rule.reviewers?.length !== 1 ||
    rule.reviewers[0].type !== 'User' ||
    String(rule.reviewers[0].reviewer?.id) !== '33728924') {
  fail('PROD release requires the explicit owner reviewer and a human Environment approval');
}
const prs = await github('commits/' + sha + '/pulls');
if (!Array.isArray(prs) || !prs.some(pr => pr.merged_at && pr.state === 'closed' &&
    pr.base?.ref === 'master' && pr.base?.repo?.full_name === repo)) {
  fail('release is not from a merged pull request to master');
}
const ci = await github('actions/workflows/ci.yml/runs?head_sha=' + sha +
  '&event=push&status=success&per_page=100');
if (!ci.workflow_runs?.some(run => run.head_sha === sha && run.event === 'push' &&
    run.conclusion === 'success' && run.head_repository?.id === 1406056807)) {
  fail('the exact master commit has not passed CI');
}
const dev = await fetch('https://bem-feito-dev.web.app/deployment.json?prod-gate=' + sha, {
  headers: { 'cache-control': 'no-cache' },
  signal: AbortSignal.timeout(15000),
});
if (!dev.ok) fail('DEV publication metadata unavailable');
const deployed = await dev.json();
if (deployed.environment !== 'dev' || deployed.commit !== sha) {
  fail('DEV is not serving the exact release commit; homologate this revision before PROD');
}
// Worker promotion must also prove that this exact version has actually passed through DEV.
if (workflow.startsWith('deploy-drive-worker-prod.yml@')) {
  const workerRuns = await github('actions/workflows/deploy-drive-worker-dev.yml/runs?head_sha=' +
    sha + '&status=success&per_page=100');
  if (!workerRuns.workflow_runs?.some(run =>
    run.head_sha === sha && run.head_branch === 'master' &&
    run.conclusion === 'success' && run.event === 'workflow_dispatch')) {
    fail('this Worker version was not deployed successfully to DEV from the exact master SHA');
  }
  const devWorker = await fetch('https://bem-feito-drive-dev.ewertonmendes9.workers.dev/health', {
    signal: AbortSignal.timeout(15000),
  });
  const workerHealth = await devWorker.json();
  if (!devWorker.ok || workerHealth.status !== 'ok' || workerHealth.environment !== 'dev') {
    fail('the DEV Worker is not healthy');
  }
}
console.log('Trusted PROD release authorized: SHA ' + sha + ', validated master CI and DEV publication.');
