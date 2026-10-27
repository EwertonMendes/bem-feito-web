import { env } from './prod-fixture.mjs';
import { inspectBundle } from '../deploy/assert-prod-bundle.mjs';

inspectBundle('dist/bem-feito-web/browser', env.PROD_FIREBASE_PROJECT_ID,
  env.PROD_WORKER_ORIGIN, 'a'.repeat(40));
console.log('Synthetic PROD bundle passed identity/isolation checks.');
