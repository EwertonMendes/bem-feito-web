import { readFile } from 'node:fs/promises';
import { ownerAuth, cloudRequest } from './cloud-access.mjs';
const config = JSON.parse(await readFile(new URL('./config.json', import.meta.url), 'utf8'));
const target = process.argv.includes('--prod') ? 'prod' : 'dev';
const env = config.environments[target];
if (!env || (target === 'dev' && env.projectId !== 'bem-feito-dev')) throw new Error('Real destination must be configured first');
const readPermissions = ['datastore.databases.get', 'datastore.databases.getMetadata', 'datastore.entities.get', 'datastore.entities.list'];
const writePermissions = [...readPermissions, 'datastore.entities.create', 'datastore.entities.update', 'datastore.entities.delete'];
const condition = [
  `assertion.repository=='${config.repository}'`,
  `assertion.repository_id=='${config.repositoryId}'`,
  `assertion.repository_owner_id=='${config.ownerId}'`,
  `assertion.ref=='refs/heads/master'`,
  `assertion.ref_type=='branch'`,
  `assertion.workflow_ref=='${config.repository}/.github/workflows/${config.workflow}@refs/heads/master'`,
  `assertion.event_name in ['issue_comment','workflow_dispatch']`,
  `assertion.runner_environment=='github-hosted'`,
  `assertion.environment in ['data-${target}-preview','data-${target}-execute']`,
  `(assertion.environment!='data-prod-execute' || assertion.event_name=='workflow_dispatch')`,
].join(' && ');
const archivePermissions = ['datastore.databases.getMetadata', 'datastore.entities.get', 'datastore.entities.create'];
const plan = { target, project: env.projectId, serviceAccounts: [env.reader, env.writer], permissions: { reader: readPermissions, writer: writePermissions, archive: archivePermissions }, provider: env.provider, condition, archive: { project: env.archive?.projectId, database: '(default)', retention: 'indefinite', billing: 'must-be-disabled' } };
console.log(JSON.stringify(plan, null, 2));
if (!process.argv.includes('--apply')) process.exit(0);
const auth = ownerAuth();
const call = (url, method, data) => cloudRequest(auth, url, method, data);
const project = await call(`https://cloudresourcemanager.googleapis.com/v1/projects/${env.projectId}`);
if (String(project.projectNumber) !== env.projectNumber || project.projectId !== env.projectId) throw new Error('Project identity differs');
const billing = await call(`https://cloudbilling.googleapis.com/v1/projects/${env.projectId}/billingInfo`);
if (billing.billingEnabled || billing.billingAccountName) throw new Error('Billing must remain disabled; no paid resources may be provisioned');
// Create only new dedicated resources. Never edit the existing deploy provider or service account.
async function ensure(url, createUrl, body) {
  try { return await call(url); }
  catch (error) { if (!error.message.includes('HTTP 404')) throw error; return call(createUrl, 'POST', body); }
}
async function waitOperation(operation) {
  if (operation?.error) throw new Error('IAM provisioning operation failed');
  if (!operation?.name?.includes('/operations/') || operation.done) return;
  for (let attempts = 0; attempts < 30; attempts++) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    const current = await call(`https://iam.googleapis.com/v1/${operation.name}`);
    if (current.error) throw new Error('IAM provisioning operation failed');
    if (current.done) return;
  }
  throw new Error('IAM provisioning still pending; inspect operation before retry');
}
for (const email of [env.reader, env.writer]) {
  const id = email.split('@')[0];
  await ensure(`https://iam.googleapis.com/v1/projects/${env.projectId}/serviceAccounts/${email}`, `https://iam.googleapis.com/v1/projects/${env.projectId}/serviceAccounts`, { accountId: id, serviceAccount: { displayName: id, description: 'GitHub data administration through restricted OIDC; no static keys' } });
}
const roles = {
  dataAdminRead: { title: 'Data administration read', includedPermissions: readPermissions, stage: 'GA' },
  dataAdminWrite: { title: 'Data administration write', includedPermissions: writePermissions, stage: 'GA' },
};
for (const [id, role] of Object.entries(roles)) {
  const current = await ensure(`https://iam.googleapis.com/v1/projects/${env.projectId}/roles/${id}`, `https://iam.googleapis.com/v1/projects/${env.projectId}/roles`, { roleId: id, role });
  if (JSON.stringify([...current.includedPermissions ?? []].sort()) !== JSON.stringify([...role.includedPermissions].sort())) throw new Error('Existing custom role differs; review instead of expanding automatically');
}
const poolUrl = `https://iam.googleapis.com/v1/projects/${env.projectNumber}/locations/global/workloadIdentityPools/github-data`;
await waitOperation(await ensure(poolUrl, `${poolUrl.slice(0, poolUrl.lastIndexOf('/'))}?workloadIdentityPoolId=github-data`, { displayName: 'GitHub data administration', description: 'Isolated from application deployment' }));
const providerUrl = `https://iam.googleapis.com/v1/${env.provider}`;
const providerBody = { displayName: 'Trusted data workflow', attributeMapping: { 'google.subject': "'github:' + assertion.repository_id + ':' + assertion.environment", 'attribute.repository_id': 'assertion.repository_id', 'attribute.environment': 'assertion.environment' }, attributeCondition: condition, oidc: { issuerUri: 'https://token.actions.githubusercontent.com' } };
const createdProvider = await ensure(providerUrl, `${providerUrl.slice(0, providerUrl.lastIndexOf('/'))}?workloadIdentityPoolProviderId=github`, providerBody);
await waitOperation(createdProvider);
const provider = await call(providerUrl);
if (provider.attributeCondition !== condition || provider.oidc?.issuerUri !== providerBody.oidc.issuerUri || JSON.stringify(Object.entries(provider.attributeMapping).sort()) !== JSON.stringify(Object.entries(providerBody.attributeMapping).sort()) || provider.state !== 'ACTIVE' || provider.disabled) throw new Error('Existing provider differs; manual trust review required');
for (const [email, phase] of [[env.reader, 'preview'], [env.writer, 'execute']]) {
  const url = `https://iam.googleapis.com/v1/projects/${env.projectId}/serviceAccounts/${email}`;
  const policy = await call(`${url}:getIamPolicy`, 'POST');
  const subject = `github:${config.repositoryId}:data-${target}-${phase}`;
  const member = `principal://iam.googleapis.com/projects/${env.projectNumber}/locations/global/workloadIdentityPools/github-data/subject/${subject}`;
  policy.bindings ??= [];
  if (!policy.bindings.some(b => b.role === 'roles/iam.workloadIdentityUser' && b.members?.includes(member))) {
    policy.bindings.push({ role: 'roles/iam.workloadIdentityUser', members: [member] });
    await call(`${url}:setIamPolicy`, 'POST', { policy });
  }
}
const policy = await call(`https://cloudresourcemanager.googleapis.com/v1/projects/${env.projectId}:getIamPolicy`, 'POST', { options: { requestedPolicyVersion: 3 } });
policy.version = 3; policy.bindings ??= [];
for (const [email, role] of [[env.reader, 'dataAdminRead'], [env.writer, 'dataAdminWrite']]) {
  const fullRole = `projects/${env.projectId}/roles/${role}`;
  const member = `serviceAccount:${email}`;
  const expression = `resource.name == 'projects/${env.projectId}/databases/(default)'`;
  if (!policy.bindings.some(b => b.role === fullRole && b.members?.includes(member) && b.condition?.expression === expression)) policy.bindings.push({ role: fullRole, members: [member], condition: { title: 'default-database-only', expression } });
}
await call(`https://cloudresourcemanager.googleapis.com/v1/projects/${env.projectId}:setIamPolicy`, 'POST', { policy });
const archive = env.archive;
if (archive?.kind !== 'firestore' || archive.projectId === env.projectId || archive.databaseId !== '(default)') throw new Error('Independent free-tier archive configuration required');
const archiveProject = await call(`https://cloudresourcemanager.googleapis.com/v1/projects/${archive.projectId}`);
const archiveBilling = await call(`https://cloudbilling.googleapis.com/v1/projects/${archive.projectId}/billingInfo`);
if (archiveBilling.billingEnabled || archiveBilling.billingAccountName) throw new Error('Archive billing must remain disabled');
const archiveDb = await call(`https://firestore.googleapis.com/v1/projects/${archive.projectId}/databases/(default)`);
if (archiveDb.databaseEdition !== 'STANDARD' || archiveDb.type !== 'FIRESTORE_NATIVE' || archiveDb.locationId !== 'southamerica-east1' || archiveDb.deleteProtectionState !== 'DELETE_PROTECTION_ENABLED' || archiveDb.freeTier !== true || archiveDb.pointInTimeRecoveryEnablement !== 'POINT_IN_TIME_RECOVERY_DISABLED') throw new Error('Archive database protection/free tier differs');
const archiveRelease = await call(`https://firebaserules.googleapis.com/v1/projects/${archive.projectId}/releases/cloud.firestore`);
const archiveRules = await call(`https://firebaserules.googleapis.com/v1/${archiveRelease.rulesetName}`);
const expectedRules = await readFile(new URL('./archive.rules', import.meta.url), 'utf8');
if (archiveRules.source?.files?.length !== 1 || archiveRules.source.files[0].content !== expectedRules) throw new Error('Private archive client rules differ');
const roleId = 'dataArchiveAppend';
const role = { title: 'Private archive read and create only', includedPermissions: archivePermissions, stage: 'GA' };
const archiveRole = await ensure(`https://iam.googleapis.com/v1/projects/${archive.projectId}/roles/${roleId}`, `https://iam.googleapis.com/v1/projects/${archive.projectId}/roles`, { roleId, role });
if (JSON.stringify([...archiveRole.includedPermissions].sort()) !== JSON.stringify([...archivePermissions].sort())) throw new Error('Archive role differs; review required');
const archivePolicy = await call(`https://cloudresourcemanager.googleapis.com/v1/projects/${archive.projectId}:getIamPolicy`, 'POST', { options: { requestedPolicyVersion: 3 } });
archivePolicy.version = 3; archivePolicy.bindings ??= [];
const archiveExpression = `resource.name == 'projects/${archive.projectId}/databases/(default)'`;
for (const email of [env.reader, env.writer]) {
  const fullRole = `projects/${archive.projectId}/roles/${roleId}`;
  const member = `serviceAccount:${email}`;
  if (!archivePolicy.bindings.some(b => b.role === fullRole && b.members?.includes(member) && b.condition?.expression === archiveExpression)) archivePolicy.bindings.push({ role: fullRole, members: [member], condition: { title: 'private-default-archive-only', expression: archiveExpression } });
}
if (archivePolicy.bindings.some(b => b.members?.some(m => ['allUsers', 'allAuthenticatedUsers'].includes(m)))) throw new Error('Public archive binding rejected');
await call(`https://cloudresourcemanager.googleapis.com/v1/projects/${archive.projectId}:setIamPolicy`, 'POST', { policy: archivePolicy });
console.log(JSON.stringify({ result: 'Dedicated identities, restricted provider and independent free-tier archive configured', archiveProjectNumber: archiveProject.projectNumber }));
