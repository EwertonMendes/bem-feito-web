import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createFrontendConfig } from '../deploy/prepare-prod-environment.mjs';
import { createWorkerConfig } from '../deploy/prepare-prod-worker-config.mjs';
import { productionOrigin } from '../deploy/prod-config.mjs';

import { env } from './prod-fixture.mjs';

test('Angular prod config is generated with separate Firebase, Google Picker and Worker resources', () => {
  const output = createFrontendConfig(env);
  assert.match(output, /"production": true/);
  assert.match(output, /"enabled": true/);
  assert.match(output, /"projectId": "bem-feito-prod"/);
  assert.ok(!output.includes('bem-feito-dev'));
  assert.ok(!output.includes('312978463343'));
});
test('Worker prod config requires distinct D1, private OAuth origin and disabled-by-default OAuth', () => {
  const output = JSON.parse(createWorkerConfig(env));
  assert.equal(output.env.prod.vars.ENVIRONMENT, 'production');
  assert.equal(output.env.prod.vars.OAUTH_ENABLED, 'false');
  assert.equal(output.env.prod.d1_databases[0].database_name, 'bem-feito-drive-prod');
  assert.equal(output.env.prod.vars.FIREBASE_PROJECT_ID, env.PROD_FIREBASE_PROJECT_ID);
  assert.equal(output.env.prod.vars.OAUTH_REDIRECT_URI, env.PROD_OAUTH_REDIRECT_URI);
  assert.ok(!JSON.stringify(output).includes('TOKEN_KEYS'));
  assert.ok(!JSON.stringify(output).includes('GOOGLE_CLIENT_SECRET'));
});
test('Missing or cross-environment values fail closed instead of falling back to DEV', () => {
  const badCases = [
    [{ PROD_FIREBASE_PROJECT_ID: 'bem-feito-dev' }, createFrontendConfig],
    [{ PROD_FIREBASE_API_KEY: '' }, createFrontendConfig],
    [{ PROD_WORKER_ORIGIN: 'https://bem-feito-drive-dev.ewertonmendes9.workers.dev' }, createFrontendConfig],
    [{ PROD_FIREBASE_MESSAGING_SENDER_ID: '312978463343' }, createFrontendConfig],
    [{ PROD_FRONTEND_ORIGIN: 'https://bem-feito-dev.web.app' }, createFrontendConfig],
    [{ PROD_D1_DATABASE_ID: 'baf5dfa3-b9e6-4749-8f64-0cdcf4f482da' }, createWorkerConfig],
    [{ PROD_OAUTH_REDIRECT_URI: 'https://incorrect.example.workers.dev/oauth/drive/callback' }, createWorkerConfig],
    [{ PROD_OAUTH_ENABLED: 'yes' }, createWorkerConfig],
    [{ PROD_GOOGLE_OAUTH_SERVER_CLIENT_ID: '312978463343-test.apps.googleusercontent.com' }, createWorkerConfig],
  ];
  for (const [override, fn] of badCases) assert.throws(() => fn({ ...env, ...override }));
  assert.throws(() => productionOrigin('http://example.com', 'URL'));
  assert.throws(() => productionOrigin('https://example.com/path', 'URL'));
});
test('Deploy workflows demand protected human-approved PROD and never reuse DEV service accounts', () => {
  for (const path of ['deploy-prod.yml', 'deploy-drive-worker-prod.yml']) {
    const workflow = readFileSync('.github/workflows/' + path, 'utf8');
    assert.match(workflow, /workflow_dispatch:/);
    assert.match(workflow, /name: prod/);
    assert.match(workflow, /verify-prod-release.mjs/g);
    assert.match(workflow, /ref: \$\{\{ inputs\.release_sha \}\}/);
    assert.doesNotMatch(workflow, /github-deploy@bem-feito-dev/);
    assert.doesNotMatch(workflow, /FIREBASE_TOKEN|credentials_json/);
  }
  assert.match(readFileSync('.github/workflows/deploy-prod.yml', 'utf8'), /--project "\$PROD_FIREBASE_PROJECT_ID"/);
  assert.match(readFileSync('.github/workflows/deploy-drive-worker-prod.yml', 'utf8'), /--env prod/);
});
