import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { productionProject, validateProductionIdentity } from './prod-config.mjs';

export function inspectBundle(directory, projectId, workerOrigin, deploymentSha) {
  const marker = JSON.parse(readFileSync(join(directory, 'deployment.json'), 'utf8'));
  if (marker.environment !== 'prod' || marker.commit !== deploymentSha ||
      !/^[a-f0-9]{40}$/.test(deploymentSha)) {
    throw new Error('Published bundle metadata must identify the approved PROD release SHA');
  }
  let js = '';
  function collect(path) {
    for (const entry of readdirSync(path)) {
      const name = join(path, entry);
      if (statSync(name).isDirectory()) collect(name);
      else if (/\.(js|html|json)$/.test(name)) js += readFileSync(name, 'utf8');
    }
  }
  collect(directory);
  for (const dev of ['bem-feito-dev', 'bem-feito-drive-dev', '312978463343', 'baf5dfa3-b9e6-4749-8f64-0cdcf4f482da']) {
    if (js.includes(dev)) throw new Error('DEV resource identifier detected in PROD bundle');
  }
  if (!js.includes(projectId) || !js.includes(workerOrigin)) {
    throw new Error('PROD Firebase and Worker identities are missing from the compiled bundle');
  }
  return true;
}
if (process.argv[1]?.replace(/\\/g, '/').endsWith('/assert-prod-bundle.mjs')) {
  const { workerOrigin } = validateProductionIdentity(process.env);
  inspectBundle(resolve('dist/bem-feito-web/browser'), productionProject(process.env),
    workerOrigin, process.env.DEPLOY_COMMIT);
  console.log('Production bundle contains the approved target and no known DEV identities.');
}
