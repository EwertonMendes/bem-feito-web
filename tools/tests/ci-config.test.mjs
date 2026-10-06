import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';

const workflow = readFileSync('.github/workflows/deploy-dev.yml', 'utf8');
const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));

test('DEV deployment waits for successful master CI and a merged PR', () => {
  for (const expected of [
    'workflow_run:',
    'workflows: [CI]',
    'branches: [master]',
    "github.event.workflow_run.conclusion == 'success'",
    "github.event.workflow_run.event == 'push'",
    'listPullRequestsAssociatedWithCommit',
    "pull.base.ref === 'master'",
    'DEV_AUTO_DEPLOY_ENABLED',
  ]) {
    assert.ok(workflow.includes(expected), `Missing deployment safeguard: ${expected}`);
  }
});

test('DEV deployment uses keyless Google Cloud authentication', () => {
  for (const expected of [
    'id-token: write',
    'google-github-actions/auth@v3',
    'projects/312978463343/locations/global/workloadIdentityPools/github-actions/providers/github',
    'github-deploy@bem-feito-dev.iam.gserviceaccount.com',
  ]) {
    assert.ok(workflow.includes(expected), `Missing keyless authentication setting: ${expected}`);
  }

  for (const forbidden of ['credentials_json', 'FIREBASE_TOKEN', '--token', 'service-account.json']) {
    assert.ok(!workflow.includes(forbidden), `Long-lived credential pattern is forbidden: ${forbidden}`);
  }
});

test('DEV deployment is pinned to the validated commit and verifies the published revision', () => {
  for (const expected of [
    'ref: ${{ needs.gate.outputs.sha }}',
    'npm run deploy:prepare:dev',
    'npm run build:dev:hosting',
    'npm run firebase:deploy:dev:ci',
    'npm run deploy:verify:dev',
  ]) {
    assert.ok(workflow.includes(expected), `Missing deployment integrity step: ${expected}`);
  }

  assert.match(packageJson.scripts['firebase:deploy:dev:ci'], /--project bem-feito-dev/);
  assert.match(packageJson.scripts['firebase:deploy:dev:ci'], /--only firestore,hosting/);
  assert.match(packageJson.scripts['firebase:deploy:dev:ci'], /--non-interactive/);
  assert.equal(packageJson.scripts['deploy:prepare:dev'], 'node tools/deploy/prepare-deployment.mjs');
  assert.equal(packageJson.scripts['deploy:verify:dev'], 'node tools/deploy/verify-deployment.mjs');
});
