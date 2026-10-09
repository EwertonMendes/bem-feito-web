import { readFile } from 'node:fs/promises';
import { ownerAuth, cloudRequest } from './cloud-access.mjs';
const config = JSON.parse(await readFile(new URL('./config.json', import.meta.url), 'utf8'));
const archive = config.environments.dev.archive;
if (archive.kind !== 'firestore' || archive.projectId !== 'bem-feito-archive-dev') throw new Error('Approved private archive project differs');
console.log(JSON.stringify({ projectId: archive.projectId, database: '(default)', edition: 'STANDARD', location: 'southamerica-east1', billing: 'disabled', publicAccess: 'deny-all', deletionProtection: 'enabled' }));
if (!process.argv.includes('--apply')) process.exit(0);
const auth = ownerAuth();
const call = (url, method, data) => cloudRequest(auth, url, method, data);
const project = await call(`https://cloudresourcemanager.googleapis.com/v1/projects/${archive.projectId}`);
const billing = await call(`https://cloudbilling.googleapis.com/v1/projects/${archive.projectId}/billingInfo`);
if (project.projectId !== archive.projectId || billing.billingEnabled || billing.billingAccountName) throw new Error('Private archive must exist without any billing account');
async function wait(operation, base) {
  if (operation.error) throw new Error('Private archive provisioning operation failed');
  if (operation.done) return;
  for (let attempt = 0; attempt < 30; attempt++) {
    const state = await call(`${base}/${operation.name}`);
    if (state.error) throw new Error('Private archive provisioning operation failed');
    if (state.done) return;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error('Private archive provisioning pending; inspect and rerun');
}
for (const api of ['firestore.googleapis.com', 'firebaserules.googleapis.com']) await wait(await call(`https://serviceusage.googleapis.com/v1/projects/${project.projectNumber}/services/${api}:enable`, 'POST'), 'https://serviceusage.googleapis.com/v1');
const root = `https://firestore.googleapis.com/v1/projects/${archive.projectId}/databases`;
const databases = (await call(root)).databases ?? [];
if (databases.some(database => database.name !== `projects/${archive.projectId}/databases/(default)`)) throw new Error('Private archive must have only its free default database');
if (databases.length === 0) {
  await wait(await call(`${root}?databaseId=(default)`, 'POST', { type: 'FIRESTORE_NATIVE', databaseEdition: 'STANDARD', locationId: 'southamerica-east1', deleteProtectionState: 'DELETE_PROTECTION_ENABLED' }), 'https://firestore.googleapis.com/v1');
}
const database = await call(`${root}/(default)`);
if (database.deleteProtectionState !== 'DELETE_PROTECTION_ENABLED' || database.databaseEdition !== 'STANDARD' || database.locationId !== 'southamerica-east1' || database.freeTier !== true || database.pointInTimeRecoveryEnablement !== 'POINT_IN_TIME_RECOVERY_DISABLED') throw new Error('Archive database protection/free tier differs');
const rulesRoot = `https://firebaserules.googleapis.com/v1/projects/${archive.projectId}`;
const content = await readFile(new URL('./archive.rules', import.meta.url), 'utf8');
try {
  const existing = await call(`${rulesRoot}/releases/cloud.firestore`);
  const existingRules = await call(`https://firebaserules.googleapis.com/v1/${existing.rulesetName}`);
  if (existingRules.source?.files?.length !== 1 || existingRules.source.files[0].content !== content) throw new Error('Existing archive rules differ; review required');
  console.log('Private free-tier archive protection verified.'); process.exit(0);
}
catch (error) {
  if (!error.message.includes('HTTP 404')) throw error;
  const ruleset = await call(`${rulesRoot}/rulesets`, 'POST', { source: { files: [{ name: 'firestore.rules', content }] } });
  const release = { name: `projects/${archive.projectId}/releases/cloud.firestore`, rulesetName: ruleset.name };
  await call(`${rulesRoot}/releases`, 'POST', release);
  console.log('Private free-tier archive created with deny-all rules.'); process.exit(0);
}
