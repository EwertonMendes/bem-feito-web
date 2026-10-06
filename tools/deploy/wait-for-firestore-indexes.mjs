import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const project = process.env.GOOGLE_CLOUD_PROJECT?.trim()
  || process.env.GCLOUD_PROJECT?.trim()
  || 'bem-feito-dev';
const database = process.env.FIRESTORE_DATABASE?.trim() || '(default)';
const intervalMs = Number(process.env.FIRESTORE_INDEX_WAIT_INTERVAL_MS ?? 15000);
const maxAttempts = Number(process.env.FIRESTORE_INDEX_WAIT_ATTEMPTS ?? 80);

if (!Number.isFinite(intervalMs) || intervalMs < 1000) {
  throw new Error('FIRESTORE_INDEX_WAIT_INTERVAL_MS must be at least 1000.');
}
if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
  throw new Error('FIRESTORE_INDEX_WAIT_ATTEMPTS must be a positive integer.');
}

const configuration = JSON.parse(readFileSync('firestore.indexes.json', 'utf8'));
const expected = configuration.indexes ?? [];

const fieldMode = (field) => {
  if (field.order) return `order:${field.order}`;
  if (field.arrayConfig) return `array:${field.arrayConfig}`;
  if (field.vectorConfig) return `vector:${JSON.stringify(field.vectorConfig)}`;
  return 'unknown';
};

const indexKey = (index) => {
  const fields = (index.fields ?? [])
    .filter((field) => field.fieldPath !== '__name__')
    .map((field) => `${field.fieldPath}:${fieldMode(field)}`)
    .join('|');
  return `${index.collectionGroup}::${index.queryScope ?? 'COLLECTION'}::${fields}`;
};

const expectedKeys = new Map(expected.map((index) => [indexKey(index), index]));
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
  const raw = execFileSync(
    'gcloud',
    [
      'firestore',
      'indexes',
      'composite',
      'list',
      '--project',
      project,
      '--database',
      database,
      '--format=json',
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
  );
  const deployed = JSON.parse(raw);
  const deployedByKey = new Map(deployed.map((index) => [indexKey(index), index]));
  const pending = [];

  for (const [key, index] of expectedKeys) {
    const current = deployedByKey.get(key);
    if (!current) {
      pending.push(`${index.collectionGroup}: not visible yet`);
      continue;
    }
    if (current.state === 'NEEDS_REPAIR') {
      throw new Error(`Firestore index requires repair: ${index.collectionGroup} (${key}).`);
    }
    if (current.state !== 'READY') {
      pending.push(`${index.collectionGroup}: ${current.state ?? 'UNKNOWN'}`);
    }
  }

  if (!pending.length) {
    console.log(`All ${expectedKeys.size} configured Firestore composite indexes are READY.`);
    process.exit(0);
  }

  console.log(`Firestore indexes are not ready yet (attempt ${attempt}/${maxAttempts}): ${pending.join(', ')}`);
  if (attempt < maxAttempts) await sleep(intervalMs);
}

throw new Error(`Timed out waiting for Firestore composite indexes in ${project}/${database}.`);
