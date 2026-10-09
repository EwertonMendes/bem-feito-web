import { readFile } from 'node:fs/promises';
import { ownerAuth, cloudRequest } from './cloud-access.mjs';
import { Firestore } from 'firebase-admin/firestore';
const config = JSON.parse(await readFile(new URL('./config.json', import.meta.url), 'utf8'));
const env = config.environments.dev;
const auth = ownerAuth();
const results = await Promise.allSettled([
  cloudRequest(auth, `https://iam.googleapis.com/v1/projects/${env.projectNumber}/locations/global/workloadIdentityPools/github-actions/providers/github`),
  cloudRequest(auth, `https://cloudresourcemanager.googleapis.com/v1/projects/${env.projectId}:getIamPolicy`, 'POST', { options: { requestedPolicyVersion: 3 } }),
  cloudRequest(auth, `https://firestore.googleapis.com/v1/projects/${env.projectId}/databases`),
  cloudRequest(auth, `https://firebase.googleapis.com/v1beta1/projects?pageSize=100`),
]);
for (const [i, result] of results.entries()) {
  if (result.status === 'rejected') { console.log(JSON.stringify({ check: i, error: result.reason.message })); continue; }
  const value = result.value;
  if (i === 0) console.log(JSON.stringify({ check: 'existing-provider', ...value }));
  if (i === 1) console.log(JSON.stringify({ check: 'deploy-roles', bindings: value.bindings?.filter(b => b.members?.includes(`serviceAccount:github-deploy@${env.projectId}.iam.gserviceaccount.com`)) }));
  if (i === 1) console.log(JSON.stringify({ check: 'data-roles', bindings: value.bindings?.filter(b => b.members?.some(m => [env.reader, env.writer].some(email => m === `serviceAccount:${email}`))) }));
  if (i === 2) console.log(JSON.stringify({ check: 'databases', databases: value.databases?.map(d => ({ name: d.name, databaseEdition: d.databaseEdition, locationId: d.locationId })) }));
  if (i === 3) console.log(JSON.stringify({ check: 'bem-feito-projects', projects: value.results?.filter(p => /bem.?feito/i.test(p.projectId + p.displayName)).map(p => ({ projectId: p.projectId, projectNumber: p.projectNumber, displayName: p.displayName })) }));
}
for (const path of [env.provider, `projects/${env.projectId}/serviceAccounts/${env.reader}`, `projects/${env.projectId}/serviceAccounts/${env.writer}`]) {
  try { const value = await cloudRequest(auth, `https://iam.googleapis.com/v1/${path}`); console.log(JSON.stringify({ check: 'new-resource', name: value.name, state: value.state, disabled: value.disabled, condition: value.attributeCondition })); }
  catch (error) { console.log(JSON.stringify({ check: 'new-resource', error: error.message })); }
}
const db = new Firestore({ projectId: env.projectId, auth });
const collections = ['collections', 'fragrances', 'formats', 'formatPrices', 'units', 'paymentMethods', 'expenseCategories', 'expenseTypes', 'inputs', 'products', 'kits', 'additions', 'expenses', 'productions', 'sales', 'payments', 'stockAdjustments', 'stockMovements', 'counters', 'migrationRuns', 'migrationSources'];
const counts = {};
const existingPaths = new Set();
for (const name of collections) {
  const snapshot = await db.collection(name).select().get(); counts[name] = snapshot.size;
  for (const doc of snapshot.docs) existingPaths.add(doc.ref.path);
}
console.log(JSON.stringify({ check: 'current-business-counts-read-only', counts, total: Object.values(counts).reduce((a, b) => a + b, 0) }));
if (process.argv.includes('--compare-source')) {
  const data = JSON.parse(await readFile('tools/migration/migration-data.json', 'utf8'));
  const desired = collections.flatMap(c => Array.isArray(data[c]) ? data[c].map(item => `${c}/${item.id}`) : []);
  console.log(JSON.stringify({ check: 'replacement-capacity-read-only', currentRoots: existingPaths.size, sourceRoots: desired.length, combinedRoots: new Set([...existingPaths, ...desired]).size + 3 }));
}
await db.terminate();
