import { mkdirSync, writeFileSync } from 'node:fs';

const commit = process.env.DEPLOY_COMMIT?.trim();
if (!commit || !/^[0-9a-f]{40}$/i.test(commit)) {
  throw new Error('DEPLOY_COMMIT must be a 40-character Git commit SHA.');
}

const sourcePr = process.env.DEPLOY_SOURCE_PR?.trim() || 'manual';
const payload = {
  environment: 'dev',
  commit,
  sourcePr,
  deployedAt: new Date().toISOString(),
};

mkdirSync('public', { recursive: true });
writeFileSync('public/deployment.json', `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
console.log(`Prepared DEV deployment metadata for ${commit}.`);
