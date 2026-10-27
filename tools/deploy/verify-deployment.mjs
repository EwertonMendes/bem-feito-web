const expectedCommit = process.env.DEPLOY_COMMIT?.trim();
const environment = process.env.DEPLOY_ENVIRONMENT?.trim() || 'dev';
if (!['dev', 'prod'].includes(environment)) throw new Error('Invalid deployment environment');
if (environment === 'prod' && !process.env.DEPLOY_VERIFY_URL?.trim()) {
  throw new Error('Production verification URL is required; DEV fallback is forbidden');
}
const baseUrl = process.env.DEPLOY_VERIFY_URL?.trim() || 'https://bem-feito-dev.web.app/deployment.json';
if (environment === 'prod' && new URL(baseUrl).hostname.includes('bem-feito-dev')) {
  throw new Error('Cannot verify PROD against DEV');
}

if (!expectedCommit || !/^[0-9a-f]{40}$/i.test(expectedCommit)) {
  throw new Error('DEPLOY_COMMIT must be a 40-character Git commit SHA.');
}

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
let lastResult = 'no response';

for (let attempt = 1; attempt <= 12; attempt += 1) {
  try {
    const url = new URL(baseUrl);
    url.searchParams.set('commit', expectedCommit);
    url.searchParams.set('attempt', String(attempt));
    const response = await fetch(url, {
      headers: { 'cache-control': 'no-cache' },
    });
    if (!response.ok) {
      lastResult = `HTTP ${response.status}`;
    } else {
      const payload = await response.json();
      if (payload.commit === expectedCommit && payload.environment === environment) {
        console.log(`${environment.toUpperCase()} is serving commit ${expectedCommit}.`);
        process.exit(0);
      }
      lastResult = `received commit ${payload.commit ?? 'unknown'}`;
    }
  } catch (error) {
    lastResult = error instanceof Error ? error.message : String(error);
  }

  if (attempt < 12) await sleep(5000);
}

throw new Error(`${environment.toUpperCase()} verification failed for ${expectedCommit}: ${lastResult}.`);
