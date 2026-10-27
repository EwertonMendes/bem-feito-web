import { readFile } from 'node:fs/promises';

const config = JSON.parse(await readFile(new URL('./config.json', import.meta.url), 'utf8'));
const prod = config.environments?.prod;
const env = process.env;
if (!prod || prod.databaseId !== '(default)' ||
    prod.projectId !== env.PROD_FIREBASE_PROJECT_ID ||
    prod.reader !== env.PROD_DATA_READER_ACCOUNT ||
    prod.provider !== env.PROD_DATA_WIF_PROVIDER ||
    !prod.archive?.projectId ||
    prod.archive.projectId === prod.projectId ||
    prod.archive.projectId === config.environments.dev?.archive?.projectId ||
    prod.projectId === config.environments.dev?.projectId ||
    prod.reader === config.environments.dev?.reader ||
    !prod.provider || !prod.reader) {
  throw new Error('PROD query OIDC credentials do not exactly match the independently configured production reader');
}
console.log('Approved PROD query project, provider and read-only identity match the protected configuration.');
