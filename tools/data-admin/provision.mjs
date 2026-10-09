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
const plan = { target, project: env.projectId, serviceAccounts: [env.reader, env.writer], permissions: { reader: readPermissions, writer: writePermissions, archive: ['storage.objects.get', 'storage.objects.create'] }, provider: env.provider, condition, bucket: { name: env.bucket, location: 'SOUTHAMERICA-EAST1', retentionDays: 90, uniformAccess: true, publicAccess: 'enforced' } };
console.log(JSON.stringify(plan, null, 2));
if (!process.argv.includes('--apply')) process.exit(0);
const auth = ownerAuth();
const call = (url, method, data) => cloudRequest(auth, url, method, data);
const project = await call(`https://cloudresourcemanager.googleapis.com/v1/projects/${env.projectId}`);
if (String(project.projectNumber) !== env.projectNumber || project.projectId !== env.projectId) throw new Error('Project identity differs');
// Create only new dedicated resources. Never edit the existing deploy provider or service account.
async function ensure(url, createUrl, body) {
  try { return await call(url); }
  catch (error) { if (!error.message.includes('HTTP 404')) throw error; return call(createUrl, 'POST', body); }
}
async function waitOperation(operation) {
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
  dataArchiveRead: { title: 'Data archive read', includedPermissions: ['storage.objects.get'], stage: 'GA' },
  dataArchiveCreate: { title: 'Data archive append', includedPermissions: ['storage.objects.create'], stage: 'GA' },
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
const bucketUrl = `https://storage.googleapis.com/storage/v1/b/${env.bucket}`;
const bucket = await ensure(bucketUrl, `https://storage.googleapis.com/storage/v1/b?project=${env.projectId}`, { name: env.bucket, location: 'SOUTHAMERICA-EAST1', storageClass: 'STANDARD', iamConfiguration: { uniformBucketLevelAccess: { enabled: true }, publicAccessPrevention: 'enforced' }, retentionPolicy: { retentionPeriod: '7776000' }, versioning: { enabled: true } });
if (String(bucket.projectNumber) !== env.projectNumber || bucket.location !== 'SOUTHAMERICA-EAST1' || !bucket.iamConfiguration?.uniformBucketLevelAccess?.enabled || bucket.iamConfiguration?.publicAccessPrevention !== 'enforced' || Number(bucket.retentionPolicy?.retentionPeriod) < 7776000) throw new Error('Existing archive bucket ownership/protection differs');
const bucketPolicy = await call(`${bucketUrl}/iam?optionsRequestedPolicyVersion=3`);
bucketPolicy.version = 3; bucketPolicy.bindings ??= [];
const grants = [
  [env.reader, 'dataArchiveRead', ['plans', 'backups']],
  [env.reader, 'dataArchiveCreate', ['plans']],
  [env.writer, 'dataArchiveRead', ['plans', 'backups', 'audit']],
  [env.writer, 'dataArchiveCreate', ['backups', 'audit']],
];
for (const [email, role, prefixes] of grants) {
  const fullRole = `projects/${env.projectId}/roles/${role}`;
  const member = `serviceAccount:${email}`;
  const expression = prefixes.map(prefix => `resource.name.startsWith('projects/_/buckets/${env.bucket}/objects/${prefix}/')`).join(' || ');
  if (!bucketPolicy.bindings.some(b => b.role === fullRole && b.members?.includes(member) && b.condition?.expression === expression)) bucketPolicy.bindings.push({ role: fullRole, members: [member], condition: { title: `${role}-${email.split('@')[0]}`, expression } });
}
if (bucketPolicy.bindings.some(b => b.members?.some(m => ['allUsers', 'allAuthenticatedUsers'].includes(m)))) throw new Error('Public archive binding rejected');
await call(`${bucketUrl}/iam`, 'PUT', bucketPolicy);
console.log('Dedicated identities, restricted provider and protected archive configured; deploy identity unchanged.');
