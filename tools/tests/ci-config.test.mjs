import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';

const ciWorkflow = readFileSync('.github/workflows/ci.yml', 'utf8');
const workflow = readFileSync('.github/workflows/deploy-dev.yml', 'utf8');
const previewWorkflow = readFileSync('.github/workflows/deploy-dev-preview.yml', 'utf8');
const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));

test('CI publishes the exact DEV build as a short-lived artifact', () => {
  for (const expected of [
    'npm run deploy:prepare:dev',
    'npm run build:dev:hosting',
    'actions/upload-artifact@v4',
    'dev-hosting-${{ github.sha }}',
    'path: dist/bem-feito-web/browser',
    'retention-days: 2',
  ]) {
    assert.ok(ciWorkflow.includes(expected), `Missing validated DEV artifact step: ${expected}`);
  }
});

test('DEV preview reuses the successful push CI artifact instead of rebuilding', () => {
  for (const expected of [
    "workflow_id: 'ci.yml'",
    "event: 'push'",
    "status: 'success'",
    'actions/download-artifact@v4',
    'dev-hosting-${{ steps.source.outputs.sha }}',
    'run-id: ${{ steps.source.outputs.ci_run }}',
    'npm run deploy:verify:dev',
  ]) {
    assert.ok(previewWorkflow.includes(expected), `Missing preview artifact safeguard: ${expected}`);
  }

  assert.ok(!previewWorkflow.includes('run: npm run build:dev:hosting'), 'Preview must not rebuild the CI-validated artifact.');
});

test('DEV deployment automatically follows successful master CI from a merged PR', () => {
  for (const expected of [
    'workflow_run:',
    'workflows: [CI]',
    'branches: [master]',
    "github.event.workflow_run.conclusion == 'success'",
    "github.event.workflow_run.event == 'push'",
    'listPullRequestsAssociatedWithCommit',
    "pull.base.ref === 'master'",
    'actions/download-artifact@v4',
    'run-id: ${{ needs.gate.outputs.ci_run }}',
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

test('Firestore deploy and verification only run for Firestore-sensitive changes', () => {
  for (const source of [workflow, previewWorkflow]) {
    for (const expected of [
      'firestore.rules',
      'firestore.indexes.json',
      'src/app/core/repositories/',
      'src/app/core/firebase/',
      'src/app/core/migrations/',
      'tools/deploy/',
      '.github/workflows/',
      'Firestore-sensitive changes detected',
      'Hosting-only DEV deploy',
    ]) {
      assert.ok(source.includes(expected), `Missing Firestore impact detection: ${expected}`);
    }
  }

  for (const expected of [
    "if: ${{ steps.source.outputs.firestore == 'true' }}",
    'npm run firebase:deploy:dev:firestore',
    'npm run firebase:wait-indexes:dev',
    'npm run firebase:verify-queries:dev',
  ]) {
    assert.ok(previewWorkflow.includes(expected), `Missing conditional preview Firestore safeguard: ${expected}`);
  }

  for (const expected of [
    "if: ${{ needs.gate.outputs.firestore == 'true' }}",
    'npm run firebase:deploy:dev:firestore',
    'npm run firebase:wait-indexes:dev',
    'npm run firebase:verify-queries:dev',
  ]) {
    assert.ok(workflow.includes(expected), `Missing conditional master Firestore safeguard: ${expected}`);
  }
});

test('DEV waits for Firestore indexes before publishing a UI that depends on them', () => {
  for (const source of [workflow, previewWorkflow]) {
    const firestore = source.indexOf('npm run firebase:deploy:dev:firestore');
    const wait = source.indexOf('npm run firebase:wait-indexes:dev');
    const verify = source.indexOf('npm run firebase:verify-queries:dev');
    const hosting = source.indexOf('npm run firebase:deploy:dev:hosting');
    assert.ok(
      firestore >= 0 && wait > firestore && verify > wait && hosting > verify,
      'Firestore, index wait, query verification and hosting must stay ordered.',
    );
  }

  assert.match(packageJson.scripts['firebase:deploy:dev:firestore'], /--project bem-feito-dev/);
  assert.match(packageJson.scripts['firebase:deploy:dev:firestore'], /--only firestore/);
  assert.equal(packageJson.scripts['firebase:wait-indexes:dev'], 'node tools/deploy/wait-for-firestore-indexes.mjs');
  assert.equal(packageJson.scripts['firebase:verify-queries:dev'], 'node tools/deploy/verify-firestore-queries.mjs');
  assert.match(packageJson.scripts['firebase:deploy:dev:hosting'], /--only hosting/);
});

test('DEV deployment stays pinned to the CI-validated commit and verifies the published revision', () => {
  for (const expected of [
    'ref: ${{ needs.gate.outputs.sha }}',
    'dev-hosting-${{ needs.gate.outputs.sha }}',
    'npm run deploy:verify:dev',
  ]) {
    assert.ok(workflow.includes(expected), `Missing deployment integrity step: ${expected}`);
  }

  assert.equal(packageJson.scripts['deploy:prepare:dev'], 'node tools/deploy/prepare-deployment.mjs');
  assert.equal(packageJson.scripts['deploy:verify:dev'], 'node tools/deploy/verify-deployment.mjs');
});

test('Dashboard aggregation indexes cover every filtered sum query', () => {
  const indexConfig = JSON.parse(readFileSync('firestore.indexes.json', 'utf8'));
  const keys = new Set(indexConfig.indexes.map((index) =>
    `${index.collectionGroup}|${index.fields.map((field) => `${field.fieldPath}:${field.order ?? field.arrayConfig}`).join('|')}`
  ));

  for (const expected of [
    'sales|status:ASCENDING|businessDate:ASCENDING|totalCents:ASCENDING',
    'sales|status:ASCENDING|analyticsVersion:ASCENDING|businessDate:ASCENDING|cogsCents:ASCENDING|itemsSold:ASCENDING|missingCostItems:ASCENDING',
    'payments|status:ASCENDING|businessDate:ASCENDING|amountReceivedCents:ASCENDING|appliedCents:ASCENDING|tipCents:ASCENDING',
    'expenses|businessDate:ASCENDING|amountCents:ASCENDING',
    'expenses|kind:ASCENDING|businessDate:ASCENDING|amountCents:ASCENDING',
  ]) {
    assert.ok(keys.has(expected), `Missing Dashboard aggregation index: ${expected}`);
  }
});
