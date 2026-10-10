import { execFileSync } from 'node:child_process';

const project = process.env.GOOGLE_CLOUD_PROJECT?.trim()
  || process.env.GCLOUD_PROJECT?.trim()
  || 'bem-feito-dev';
const database = process.env.FIRESTORE_DATABASE?.trim() || '(default)';
const intervalMs = Number(process.env.FIRESTORE_INDEX_WAIT_INTERVAL_MS ?? 15000);
const maxAttempts = Number(process.env.FIRESTORE_INDEX_WAIT_ATTEMPTS ?? 80);
const firebasePackage = 'firebase-tools@15.32.1';

if (!Number.isFinite(intervalMs) || intervalMs < 1000) {
  throw new Error('FIRESTORE_INDEX_WAIT_INTERVAL_MS must be at least 1000.');
}
if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
  throw new Error('FIRESTORE_INDEX_WAIT_ATTEMPTS must be a positive integer.');
}

const stripAnsi = (value) => value.replace(/\u001b\[[0-9;]*m/g, '');
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
  const raw = execFileSync(
    'npx',
    [
      '--yes',
      '--package',
      firebasePackage,
      'firebase',
      'firestore:indexes',
      '--project',
      project,
      '--database',
      database,
      '--pretty',
      '--non-interactive',
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
  );

  const output = stripAnsi(raw);
  const states = [...output.matchAll(/\[(READY|CREATING|NEEDS_REPAIR)\]/g)].map((match) => match[1]);

  if (!states.length) {
    throw new Error('Firebase CLI did not report Firestore composite index states.');
  }
  if (states.includes('NEEDS_REPAIR')) {
    throw new Error('At least one Firestore composite index requires repair.');
  }
  if (states.every((state) => state === 'READY')) {
    console.log(`All ${states.length} Firestore composite indexes are READY.`);
    process.exit(0);
  }

  const creating = states.filter((state) => state === 'CREATING').length;
  console.log(
    `Firestore indexes are still building (attempt ${attempt}/${maxAttempts}, ${creating} creating).`,
  );
  if (attempt < maxAttempts) await sleep(intervalMs);
}

throw new Error(`Timed out waiting for Firestore composite indexes in ${project}/${database}.`);
