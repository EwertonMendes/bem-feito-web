import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateRequest, assertDestination, assertScope, requestHash, hash, redact } from './schema.ts';
import { parseCommand, assertPermission, assertPull, assertTrustedMasterMigration, authorize } from './gate.ts';
import { FirestoreArchive } from './storage.ts';
import { report, validBackupPath } from './engine.ts';
import { encode } from './codec.ts';
const config = JSON.parse(await readFile(new URL('./config.json', import.meta.url), 'utf8'));
const commit = 'a'.repeat(40);
const request = { schemaVersion: 1, id: 'cost-test', environment: 'dev', projectId: 'bem-feito-dev', operation: 'update', changes: [{ collection: 'inputs', id: 'I00001', action: 'update', expected: { averageUnitCostCents: 100 }, values: { averageUnitCostCents: 150 } }] };
test('schema rejects arbitrary code, queries, fields, credentials and protected collections', () => {
  for (const extra of [{ shell: 'rm -rf /' }, { javascript: 'eval()' }, { sql: 'DROP TABLE sales' }, { credential: 'fake' }, { arbitrary: {} }]) assert.throws(() => validateRequest({ ...request, ...extra }));
  for (const collection of ['users', 'system', 'integrations', 'dataAdminOperations', 'sales', 'payments']) assert.throws(() => validateRequest({ ...request, changes: [{ ...request.changes[0], collection }] }));
  for (const value of [-1, 1.2, 1_000_000_001, '150', Infinity, null]) assert.throws(() => validateRequest({ ...request, changes: [{ ...request.changes[0], values: { averageUnitCostCents: value } }] }));
  for (const id of ['../users', 'a/b', '__proto__', '', 'a'.repeat(101)]) assert.throws(() => validateRequest({ ...request, changes: [{ ...request.changes[0], id }] }));
  assert.throws(() => validateRequest({ ...request, changes: [request.changes[0], request.changes[0]] }));
  assert.throws(() => validateRequest({ ...request, changes: [{ ...request.changes[0], expected: {} }] }));
  assert.throws(() => validateRequest({ ...request, schemaVersion: 2 }));
});
test('DEV cannot select PROD; unknown production destination fails closed', () => {
  assert.equal(assertDestination(validateRequest(request), config).projectId, 'bem-feito-dev');
  assert.throws(() => assertDestination(validateRequest({ ...request, environment: 'prod' }), config));
  assert.throws(() => assertDestination(validateRequest({ ...request, projectId: 'other-real-project' }), config));
});
test('destructive scope and hashes are exact and insensitive to JSON key order', () => {
  assert.equal(requestHash(validateRequest(request)), requestHash(validateRequest(JSON.parse(JSON.stringify(request)))));
  assert.equal(hash({ a: 1, b: 2 }), hash({ b: 2, a: 1 }));
  assert.notEqual(hash({ a: 1 }), hash({ a: 2 }));
  assert.throws(() => assertScope({ ...request, destructive: { projectId: 'bem-feito-dev', paths: ['inputs/a'] } } as any, ['inputs/b']));
});
test('commands reject injections, branch refs, missing hashes and trailing text', () => {
  const preview = `/data-admin preview operations/requests/cost.json ${commit}`;
  assert.equal(parseCommand(preview).mode, 'preview');
  for (const body of [preview + ' && echo secret', preview.replace(commit, 'master'), preview.replace('cost.json', '../config.json'), `/data-admin apply operations/requests/cost.json ${commit}`, preview + '\nhello']) assert.throws(() => parseCommand(body));
  assert.equal(parseCommand(`/data-admin apply operations/requests/cost.json ${commit} ${'b'.repeat(64)} ${'c'.repeat(64)}`).mode, 'apply');
});
test('permissions, forks, stale SHAs, closed PRs and different branches are denied', () => {
  for (const permission of ['read', 'triage', 'none', 'unknown']) assert.throws(() => assertPermission(permission));
  for (const permission of ['write', 'maintain', 'admin']) assertPermission(permission);
  const pull = { state: 'open', base: { ref: 'master' }, head: { sha: commit, repo: { id: Number(config.repositoryId), full_name: config.repository } } };
  assertPull(pull, config, commit);
  for (const bad of [{ ...pull, state: 'closed' }, { ...pull, base: { ref: 'feature' } }, { ...pull, head: { ...pull.head, sha: 'b'.repeat(40) } }, { ...pull, head: { ...pull.head, repo: { id: 1, full_name: 'fork/repo' } } }]) assert.throws(() => assertPull(bad, config, commit));
});
test('DEV migration must match current protected master; no dependence on obsolete PR #28', () => {
  const migration = { operation: 'migrate' as const, environment: 'dev' as const, deploymentSha: commit };
  assertTrustedMasterMigration(migration, commit);
  assert.throws(() => assertTrustedMasterMigration(migration, 'b'.repeat(40)), /exact current protected master/);
  assert.throws(() => assertTrustedMasterMigration({ ...migration, environment: 'prod' }, commit), /exact current protected master/);
  assertTrustedMasterMigration({ operation: 'update', environment: 'dev' }, commit);
});

test('public reports omit customer text, individual financial amounts and nested details', () => {
  const output = JSON.stringify(redact({ customerName: 'PRIVATE CUSTOMER', notes: 'PRIVATE NOTE', items: [{ phone: 'PRIVATE PHONE' }], averageUnitCostCents: 123, active: true }));
  assert.ok(!output.includes('PRIVATE')); assert.ok(!output.includes('123')); assert.ok(!output.includes('true'));
  const rows = [
    { path: 'sales/V00001', version: '1', before: encode({ customerName: 'PRIVATE', totalCents: 987654, value: 987654 }), after: encode({ totalCents: 765432 }) },
    { path: 'sales/V00002', version: null, before: encode(null), after: encode({ totalCents: 543210 }) },
    { path: 'dataAdminSmoke/smoke-test', version: '1', before: encode({ value: 10 }), after: encode({ value: 20 }) },
  ];
  const result = report({ schemaVersion: 1, requestHash: 'a'.repeat(64), projectId: 'bem-feito-dev', environment: 'dev', operation: 'migrate', scope: ['sales'], dependencies: [], rows }, {} as any);
  const serialized = JSON.stringify(result);
  for (const secret of ['PRIVATE', '987654', '765432', '543210']) assert.ok(!serialized.includes(secret));
  assert.deepEqual(result.collectionCounts.sales, { before: 1, after: 2 });
  assert.deepEqual(result.affectedDocuments[2].after, { value: 20 });
});

test('historical fixture backups stay restricted to registered migration source descendants', () => {
  for (const collection of ['additions', 'collections', 'formats', 'fragrances', 'inputs', 'kits', 'products', 'units']) assert.equal(validBackupPath(`migrationSources/legacy-run/devTestFixtures/${collection}__legacy123`), true);
  for (const path of ['users/u/devTestFixtures/units__x', 'sales/s/devTestFixtures/units__x', 'migrationSources/run/devTestFixtures/users__x', 'migrationSources/run/unknown/units__x', 'migrationSources/run/devTestFixtures/units__x/nested/x', 'migrationSources/run/devTestFixtures/units__../x']) assert.equal(validBackupPath(path), false);
});
test('authorization checks live permission and unchanged real comment actor before fetching data', async () => {
  const actor = { id: 33728924, login: 'EwertonMendes', type: 'User' };
  const body = `/data-admin preview operations/requests/cost.json ${commit}`;
  const event = { action: 'created', repository: { id: 1406056807, owner: { id: 33728924 } }, sender: actor, issue: { number: 99, pull_request: {} }, comment: { id: 123, user: actor, body } };
  const env = { GITHUB_REPOSITORY: config.repository, GITHUB_REF: 'refs/heads/master', GITHUB_WORKFLOW_REF: `${config.repository}/.github/workflows/data-admin.yml@refs/heads/master`, GITHUB_SHA: commit, GITHUB_WORKFLOW_SHA: commit, GITHUB_RUN_ATTEMPT: '1', GITHUB_EVENT_NAME: 'issue_comment', GITHUB_ACTOR: actor.login, GITHUB_TRIGGERING_ACTOR: actor.login, GITHUB_RUN_ID: '1' };
  const api = async (path: string) => {
    if (path === 'branches/master') return { protected: true, commit: { sha: commit } };
    if (path.startsWith('actions/workflows/ci.yml/runs?')) return { workflow_runs: [{ head_sha: commit, conclusion: 'success', head_repository: { id: 1406056807 } }] };
    if (path === 'issues/comments/123') return event.comment;
    if (path.startsWith('collaborators/')) return { permission: 'write', user: actor };
    if (path === 'pulls/99') return { state: 'open', base: { ref: 'master' }, head: { sha: commit, repo: { id: 1406056807, full_name: config.repository } } };
    if (path.startsWith('contents/')) return { type: 'file', size: 400, path: 'operations/requests/cost.json', encoding: 'base64', content: Buffer.from(JSON.stringify(request)).toString('base64') };
    if (path.endsWith('deployment-branch-policies')) return { branch_policies: [{ name: 'master', type: 'branch' }] };
    if (path.startsWith('environments/')) return { deployment_branch_policy: { custom_branch_policies: true } };
    throw new Error('Unexpected authorization API request');
  };
  assert.equal((await authorize(event, env, config, api)).request.id, request.id);
  await assert.rejects(authorize(event, env, config, p => p.startsWith('collaborators/') ? Promise.resolve({ permission: 'read', user: actor }) : api(p)));
  await assert.rejects(authorize({ ...event, sender: { ...actor, id: 1 } }, env, config, api));
  await assert.rejects(authorize(event, { ...env, GITHUB_RUN_ATTEMPT: '2' }, config, api));
  await assert.rejects(authorize(event, { ...env, GITHUB_REF: 'refs/heads/feature' }, config, api));
  await assert.rejects(authorize(event, env, config, p => p === 'branches/master' ? Promise.resolve({ protected: false, commit: { sha: commit } }) : api(p)));
  await assert.rejects(authorize(event, env, config, p => p.startsWith('actions/workflows/ci.yml/runs?') ? Promise.resolve({ workflow_runs: [] }) : api(p)));
  await assert.rejects(authorize(event, env, config, p => p === 'issues/comments/123' ? Promise.resolve({ ...event.comment, body: body + ' changed' }) : api(p)));
  await assert.rejects(authorize(event, { ...env, GITHUB_EVENT_NAME: 'pull_request_target' }, config, api));
});
test('PROD requires exact owner dispatch, hashes and owner environment approval without bypass', async () => {
  const actor = { id: 33728924, login: 'EwertonMendes', type: 'User' };
  const prodRequest = { ...request, environment: 'prod', projectId: 'isolated-production' };
  const prodConfig = { ...config, environments: { ...config.environments, prod: { ...config.environments.dev, projectId: 'isolated-production' } } };
  const event = { repository: { id: 1406056807, owner: { id: 33728924 } }, sender: actor, inputs: { mode: 'apply', pr: '99', path: 'operations/requests/cost.json', sha: commit, request_hash: requestHash(validateRequest(prodRequest)), plan_hash: 'c'.repeat(64) } };
  const env = { GITHUB_REPOSITORY: config.repository, GITHUB_REF: 'refs/heads/master', GITHUB_WORKFLOW_REF: `${config.repository}/.github/workflows/data-admin.yml@refs/heads/master`, GITHUB_SHA: commit, GITHUB_WORKFLOW_SHA: commit, GITHUB_RUN_ATTEMPT: '1', GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_ACTOR: actor.login, GITHUB_TRIGGERING_ACTOR: actor.login, GITHUB_RUN_ID: '1' };
  const protection = { deployment_branch_policy: { custom_branch_policies: true }, can_admins_bypass: false, protection_rules: [{ type: 'required_reviewers', prevent_self_review: false, reviewers: [{ type: 'User', reviewer: { id: 33728924 } }] }] };
  const api = async (path: string) => {
    if (path === 'branches/master') return { protected: true, commit: { sha: commit } };
    if (path.startsWith('actions/workflows/ci.yml/runs?')) return { workflow_runs: [{ head_sha: commit, conclusion: 'success', head_repository: { id: 1406056807 } }] };
    if (path.startsWith('collaborators/')) return { permission: 'admin', user: actor };
    if (path === 'pulls/99') return { state: 'open', base: { ref: 'master' }, head: { sha: commit, repo: { id: 1406056807, full_name: config.repository } } };
    if (path.startsWith('contents/')) return { type: 'file', size: 400, path: event.inputs.path, encoding: 'base64', content: Buffer.from(JSON.stringify(prodRequest)).toString('base64') };
    if (path.endsWith('deployment-branch-policies')) return { branch_policies: [{ name: 'master', type: 'branch' }] };
    if (path.startsWith('environments/')) return protection;
    throw new Error('Unexpected authorization API request');
  };
  assert.equal((await authorize(event, env, prodConfig, api)).environment, 'data-prod-execute');
  await assert.rejects(authorize(event, env, { ...prodConfig, productionApprovers: ['123456'] }, api));
  for (const bad of [{ ...protection, can_admins_bypass: true }, { ...protection, protection_rules: [] }, { ...protection, protection_rules: [{ ...protection.protection_rules[0], prevent_self_review: true }] }, { ...protection, protection_rules: [{ ...protection.protection_rules[0], reviewers: [{ type: 'User', reviewer: { id: 999 } }] }] }]) await assert.rejects(authorize(event, env, prodConfig, p => p === 'environments/data-prod-execute' ? Promise.resolve(bad) : api(p)));
  const otherActor = { id: 123456, login: 'other-writer', type: 'User' };
  await assert.rejects(authorize({ ...event, sender: otherActor }, { ...env, GITHUB_ACTOR: otherActor.login, GITHUB_TRIGGERING_ACTOR: otherActor.login }, { ...prodConfig, productionApprovers: [config.ownerId, '123456'] }, p => p.startsWith('collaborators/') ? Promise.resolve({ permission: 'write', user: otherActor }) : api(p)), /repository owner/);
  await assert.rejects(authorize({ ...event, inputs: { ...event.inputs, request_hash: 'f'.repeat(64) } }, env, prodConfig, api));
  await assert.rejects(authorize(event, env, prodConfig, p => p.endsWith('deployment-branch-policies') ? Promise.resolve({ branch_policies: [{ name: '*', type: 'branch' }] }) : api(p)));
});
test('archive IAM guard flushes deferred batchWrite and accepts only permission denials', async () => {
  const events: string[] = [];
  let rejectWrite: (error: unknown) => void = () => {};
  let denialCode = 7;
  const deny = async (name: string) => { events.push(name); throw Object.assign(new Error('simulated denial'), { code: denialCode }); };
  const db = {
    doc: () => ({ update: () => deny('commit'), delete: () => deny('delete') }),
    collection: () => ({ limit: () => ({ get: () => deny('list') }) }),
    bulkWriter: () => ({
      onWriteError: () => {},
      update: () => new Promise((_resolve, reject) => { events.push('queued-batch'); rejectWrite = reject; }),
      close: async () => { events.push('flush-batch'); rejectWrite(Object.assign(new Error('simulated denial'), { code: denialCode })); },
    }),
  };
  const archive = new FirestoreArchive(db as any);
  archive.put = async () => 'f'.repeat(64);
  archive.get = async () => ({ schemaVersion: 1 });
  assert.deepEqual(await archive.assertAccess({ runId: 'test', phase: 'preview' }), { createReadVerified: true, updateDeleteListDenied: true });
  assert.deepEqual(events, ['commit', 'queued-batch', 'flush-batch', 'delete', 'list']);
  denialCode = 5;
  await assert.rejects(archive.assertAccess({ runId: 'test', phase: 'preview' }), /denial could not be verified/);
});
