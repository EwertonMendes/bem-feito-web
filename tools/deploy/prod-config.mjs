import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export function required(env, key) {
  const value = env[key]?.trim();
  if (!value) throw new Error('Missing required production variable: ' + key);
  if (/REPLACE|UNCONFIGURED|PLACEHOLDER/i.test(value)) throw new Error('Unconfigured production variable: ' + key);
  return value;
}
export function productionProject(env) {
  const id = required(env, 'PROD_FIREBASE_PROJECT_ID');
  if (!/^[a-z][a-z0-9-]{5,29}$/.test(id) || id === 'bem-feito-dev' || id.includes('-dev')) {
    throw new Error('Invalid or non-isolated production Firebase project');
  }
  return id;
}
export function productionOrigin(value, label) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Invalid URL for ' + label); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
    url.pathname !== '/' || url.port || url.hostname.includes('bem-feito-dev') ||
    url.hostname.split('.').slice(0, -1).some(part => part === 'dev' || part.endsWith('-dev') || part.startsWith('dev-'))) {
    throw new Error(label + ' must be a separate HTTPS origin without path, query or credentials');
  }
  return url.origin;
}
export function validateProductionIdentity(env) {
  const projectId = productionProject(env);
  const frontendOrigin = productionOrigin(required(env, 'PROD_FRONTEND_ORIGIN'), 'PROD_FRONTEND_ORIGIN');
  const workerOrigin = productionOrigin(required(env, 'PROD_WORKER_ORIGIN'), 'PROD_WORKER_ORIGIN');
  if (frontendOrigin === workerOrigin) throw new Error('Frontend and Worker must have distinct origins');
  if (frontendOrigin !== 'https://' + projectId + '.web.app' &&
      frontendOrigin !== 'https://' + projectId + '.firebaseapp.com' &&
      env.PROD_APPROVED_CUSTOM_ORIGIN !== frontendOrigin) {
    throw new Error('Unexpected PROD frontend origin; approve a custom origin explicitly');
  }
  return { projectId, frontendOrigin, workerOrigin };
}
export function assertGoogleApiKey(value, key) {
  if (!/^AIza[A-Za-z0-9_-]{35}$/.test(value)) throw new Error('Invalid public Google API key format: ' + key);
  return value;
}
export function assertGoogleClientId(value, key) {
  if (!/^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(value)) {
    throw new Error('Invalid Google OAuth client ID: ' + key);
  }
  return value;
}
export function writeGenerated(file, contents) {
  const destination = resolve(file);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, contents, { encoding: 'utf8', mode: 0o600 });
}
