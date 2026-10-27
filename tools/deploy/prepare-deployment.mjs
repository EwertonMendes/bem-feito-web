import { mkdirSync, writeFileSync } from 'node:fs';

const commit = process.env.DEPLOY_COMMIT?.trim();
if (!commit || !/^[0-9a-f]{40}$/i.test(commit)) {
  throw new Error('DEPLOY_COMMIT must be a 40-character Git commit SHA.');
}

const sourcePr = process.env.DEPLOY_SOURCE_PR?.trim() || 'manual';
const environment = process.env.DEPLOY_ENVIRONMENT?.trim() || 'dev';
if (!['dev', 'prod'].includes(environment)) {
  throw new Error('Unsupported deployment environment');
}
if (environment === 'prod') {
  if (process.env.GITHUB_ACTIONS !== 'true' || process.env.GITHUB_REF !== 'refs/heads/master' ||
      process.env.GITHUB_ENVIRONMENT !== 'prod' || process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch') {
    throw new Error('PROD metadata requires the approved GitHub production workflow');
  }
}
const payload = {
  environment,
  commit,
  sourcePr,
  deployedAt: new Date().toISOString(),
};

mkdirSync('public', { recursive: true });
writeFileSync('public/deployment.json', `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
console.log(`Prepared ${environment.toUpperCase()} deployment metadata for ${commit}.`);
