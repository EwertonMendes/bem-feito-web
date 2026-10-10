import { readFile } from 'node:fs/promises';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { authorizeQuery } from './query-gate.ts';
import { validateRecipientKey, executeQueryPlan, encryptResult } from './query-gateway.ts';
import { githubApi } from './gate.ts';

try {
  const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH!, 'utf8'));
  const config = JSON.parse(await readFile(new URL('./config.json', import.meta.url), 'utf8'));
  // Revalidate after OIDC with the same exact actor, input and protected master.
  const { plan } = await authorizeQuery(event, process.env, config, p => githubApi(p, process.env.GH_TOKEN!));
  const key = validateRecipientKey(process.env.GATEWAY_KEY!);
  const app = initializeApp({ credential: applicationDefault(), projectId: 'bem-feito-dev' });
  const db = getFirestore(app, '(default)');
  const result = await executeQueryPlan(db, plan);
  const envelope = encryptResult(result, key, process.env.GATEWAY_QUERY!);
  // This is the ONLY data-bearing line. Never log JSON, customer information or monetary amounts.
  console.log('BF_QUERY_ENCRYPTED_V1=' + envelope);
  console.log('Query complete: encrypted result produced using read-only DEV identity.');
} catch {
  // Firebase exceptions may contain customer data, query literals or credentials.
  console.error('Query failed safely. Check query limits, indexes, authorization and private result size.');
  process.exitCode = 1;
}
