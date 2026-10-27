import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createFrontendConfig } from '../deploy/prepare-prod-environment.mjs';
import { createWorkerConfig } from '../deploy/prepare-prod-worker-config.mjs';
import { productionOrigin } from '../deploy/prod-config.mjs';

const env = {
  PROD_FIREBASE_PROJECT_ID: 'bem-feito-prod',
  PROD_FIREBASE_API_KEY: 'AIza' + 'a'.repeat(35),
  PROD_FIREBASE_AUTH_DOMAIN: 'bem-feito-prod.firebaseapp.com',
  PROD_FIREBASE_STORAGE_BUCKET: 'bem-feito-prod.firebasestorage.app',
  PROD_FIREBASE_MESSAGING_SENDER_ID: '987654321098',
  PROD_FIREBASE_APP_ID: '1:987654321098:web:abcdef012345',
  PROD_FRONTEND_ORIGIN: 'https://bem-feito-prod.web.app',
  PROD_WORKER_ORIGIN: 'https://bem-feito-drive-prod.example.workers.dev',
  PROD_GOOGLE_PICKER_CLIENT_ID: '987654321098-abcxyz.apps.googleusercontent.com',
  PROD_GOOGLE_PICKER_API_KEY: 'AIza' + 'b'.repeat(35),
  PROD_GOOGLE_CLOUD_PROJECT_NUMBER: '987654321098',
  PROD_GOOGLE_OAUTH_SERVER_CLIENT_ID: '987654321098-another.apps.googleusercontent.com',
  PROD_OAUTH_REDIRECT_URI: 'https://bem-feito-drive-prod.example.workers.dev/oauth/drive/callback',
  PROD_WORKER_NAME: 'bem-feito-drive-prod',
  PROD_D1_DATABASE_NAME: 'bem-feito-drive-prod',
  PROD_D1_DATABASE_ID: '127d0bbe-79b0-420a-a4c9-bb7a89587ac2',
  PROD_TOKEN_KEY_VERSION: 'v1',
  PROD_OAUTH_ENABLED: 'false',
};

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
