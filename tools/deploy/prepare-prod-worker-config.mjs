import { required, validateProductionIdentity, assertGoogleClientId, writeGenerated } from './prod-config.mjs';

export function createWorkerConfig(env) {
  const { projectId, frontendOrigin, workerOrigin } = validateProductionIdentity(env);
  const name = required(env, 'PROD_WORKER_NAME');
  const database = required(env, 'PROD_D1_DATABASE_ID');
  const oauthRedirect = required(env, 'PROD_OAUTH_REDIRECT_URI');
  const oauthEnabled = env.PROD_OAUTH_ENABLED ?? 'false';
  if (!/^[a-z0-9][a-z0-9-]{2,62}$/.test(name) || name === 'bem-feito-drive-dev' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(database) ||
    database === 'baf5dfa3-b9e6-4749-8f64-0cdcf4f482da' ||
    database === '00000000-0000-0000-0000-000000000000' ||
    oauthRedirect !== workerOrigin + '/oauth/drive/callback' ||
    !['true', 'false'].includes(oauthEnabled)) {
    throw new Error('Unsafe production Worker/D1/callback/OAuth configuration');
  }
  const config = {
    $schema: 'https://json.schemastore.org/wrangler.json',
    name: 'bem-feito-drive',
    main: 'src/index.ts',
    compatibility_date: '2026-10-01',
    workers_dev: false,
    preview_urls: false,
    env: { prod: {
      name,
      workers_dev: true,
      preview_urls: false,
      vars: {
        ENVIRONMENT: 'production',
        FIREBASE_PROJECT_ID: projectId,
        FRONTEND_ORIGIN: frontendOrigin,
        GOOGLE_CLIENT_ID: assertGoogleClientId(required(env, 'PROD_GOOGLE_OAUTH_SERVER_CLIENT_ID'), 'PROD_GOOGLE_OAUTH_SERVER_CLIENT_ID'),
        OAUTH_REDIRECT_URI: oauthRedirect,
        TOKEN_KEY_VERSION: required(env, 'PROD_TOKEN_KEY_VERSION'),
        OAUTH_ENABLED: oauthEnabled,
      },
      d1_databases: [{ binding: 'DB', database_name: required(env, 'PROD_D1_DATABASE_NAME'),
        database_id: database, migrations_dir: 'migrations' }],
      observability: { enabled: true, head_sampling_rate: 1, logs: { invocation_logs: false } },
    } },
  };
  if (config.env.prod.d1_databases[0].database_name === 'bem-feito-drive-dev' ||
      config.env.prod.vars.GOOGLE_CLIENT_ID.includes('312978463343')) {
    throw new Error('DEV resource detected in production Worker config');
  }
  return JSON.stringify(config, null, 2) + '\n';
}
if (process.argv[1]?.replace(/\\/g, '/').endsWith('/prepare-prod-worker-config.mjs')) {
  writeGenerated('worker/wrangler.generated.prod.jsonc', createWorkerConfig(process.env));
  console.log('Validated production Wrangler configuration generated (secrets remain in Cloudflare).');
}
