import { applicationDefault, cert, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const dataPath = resolve(process.argv[2] ?? 'tools/migration/migration-data.json');
const projectId = process.env.FIREBASE_PROJECT_ID;
if (!projectId) throw new Error('Defina FIREBASE_PROJECT_ID antes de importar.');

const credentialPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
const credential = credentialPath
  ? cert(JSON.parse(await readFile(resolve(credentialPath), 'utf8')))
  : applicationDefault();
initializeApp({ credential, projectId });
const db = getFirestore();
const data = JSON.parse(await readFile(dataPath, 'utf8'));
const actor = process.env.MIGRATION_ACTOR ?? 'legacy-migration';

const collections = [
  'collections', 'fragrances', 'formats', 'formatPrices', 'units', 'paymentMethods', 'expenseCategories',
  'expenseTypes', 'inputs', 'products', 'kits', 'additions', 'expenses', 'productions', 'sales', 'payments',
  'stockAdjustments', 'stockMovements', 'counters',
];

const writeAll = async (collectionName, records) => {
  const chunks = [];
  for (let index = 0; index < records.length; index += 400) chunks.push(records.slice(index, index + 400));
  for (const chunk of chunks) {
    const batch = db.batch();
    for (const record of chunk) {
      const { id, ...payload } = record;
      if (!id) throw new Error(`${collectionName}: registro sem id.`);
      const ref = db.collection(collectionName).doc(String(id));
      batch.set(ref, {
        ...payload,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        createdBy: actor,
        updatedBy: actor,
      }, { merge: false });
    }
    await batch.commit();
  }
  console.log(`${collectionName}: ${records.length}`);
};

for (const collectionName of collections) {
  const records = Array.isArray(data[collectionName]) ? data[collectionName] : [];
  await writeAll(collectionName, records);
}

await db.collection('migrationRuns').add({
  source: data.source ?? null,
  schemaVersion: data.schemaVersion ?? 1,
  importedAt: FieldValue.serverTimestamp(),
  actor,
  counts: Object.fromEntries(collections.map((name) => [name, Array.isArray(data[name]) ? data[name].length : 0])),
});
console.log(`Importação concluída no projeto ${projectId}.`);
