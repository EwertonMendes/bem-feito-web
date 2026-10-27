import { env } from './prod-fixture.mjs';
import { createFrontendConfig } from '../deploy/prepare-prod-environment.mjs';
import { createWorkerConfig } from '../deploy/prepare-prod-worker-config.mjs';
import { writeGenerated } from '../deploy/prod-config.mjs';

export const fixtureSha = 'a'.repeat(40);
writeGenerated('src/environments/environment.production.ts', createFrontendConfig(env));
writeGenerated('worker/wrangler.generated.prod.jsonc', createWorkerConfig(env));
writeGenerated('public/deployment.json', JSON.stringify({
  environment: 'prod', commit: fixtureSha, sourcePr: 'ci-synthetic-fixture',
  deployedAt: '2026-10-27T00:00:00.000Z',
}, null, 2) + '\n');
console.log('Synthetic PROD build inputs prepared for CI only.');
