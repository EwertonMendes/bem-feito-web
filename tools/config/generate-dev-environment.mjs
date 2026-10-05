import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const parseEnv = (content) => {
  const result = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const separator = line.indexOf('=');
    if (separator < 1) continue;

    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    result[key] = value;
  }
  return result;
};

const loadConfig = async () => {
  const values = {};

  for (const filename of ['.env', '.env.local']) {
    const path = resolve(filename);
    if (!existsSync(path)) continue;
    Object.assign(values, parseEnv(await readFile(path, 'utf8')));
  }

  return { ...values, ...process.env };
};

const config = await loadConfig();
const apiKey = String(config.FIREBASE_DEV_API_KEY ?? '').trim();

if (!apiKey) {
  console.error(
    [
      'FIREBASE_DEV_API_KEY is required for DEV builds.',
      'Copy .env.example to .env.local and fill the Firebase Web API key.',
      '.env.local is ignored by Git and must never be committed.',
    ].join('\n'),
  );
  process.exit(1);
}

const output = `export const environment = {
  production: false,
  name: 'development',
  catalogImagesEnabled: false,
  firebase: {
    apiKey: ${JSON.stringify(apiKey)},
    authDomain: 'bem-feito-dev.firebaseapp.com',
    projectId: 'bem-feito-dev',
    storageBucket: 'bem-feito-dev.firebasestorage.app',
    messagingSenderId: '312978463343',
    appId: '1:312978463343:web:e49e223d872b9c68374b9a'
  },
  useEmulators: false,
  emulatorHost: '127.0.0.1'
} as const;
`;

const target = resolve('src/environments/environment.generated.ts');
await writeFile(target, output, 'utf8');
console.log('Generated src/environments/environment.generated.ts from local configuration.');
