import { readFile, appendFile } from 'node:fs/promises';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { validateRequest, assertDestination, invariant, hash, requestHash } from './schema.ts';
import { FirestoreArchive } from './storage.ts';
import { apply, prepare, report } from './engine.ts';
import { prepareMigration } from './migration.ts';

try {
  invariant(process.env.GITHUB_ACTIONS === 'true' && !process.env.FIRESTORE_EMULATOR_HOST, 'CLI is for trusted GitHub workflow only; tests use injected adapters');
  const config = JSON.parse(await readFile(new URL('./config.json', import.meta.url), 'utf8'));
  const authorization = JSON.parse(await readFile('tools/data-admin/.private/authorized.json', 'utf8'));
  const request = validateRequest(authorization.request);
  const env = assertDestination(request, config);
  invariant(authorization.destination.projectId === env.projectId && authorization.actor.trustedSha === process.env.GITHUB_SHA, 'Authorization context differs');
  const app = initializeApp({ credential: applicationDefault(), projectId: env.projectId });
  const db = getFirestore(app, env.databaseId);
  invariant(env.archive?.kind === 'firestore' && env.archive.projectId !== env.projectId && env.archive.databaseId === '(default)', 'Independent free-tier archive required');
  const archiveApp = initializeApp({ credential: applicationDefault(), projectId: env.archive.projectId }, 'private-archive');
  const archive = new FirestoreArchive(getFirestore(archiveApp, env.archive.databaseId));
  const archiveAccess = await archive.assertAccess({ runId: authorization.actor.runId, phase: authorization.command.mode });
  let result;
  if (authorization.command.mode === 'preview') {
    const plan = request.operation === 'migrate' ? await prepareMigration(request, db, env) : await prepare(request, db, archive);
    const planHash = await archive.put('plans', plan);
    await archive.put('plans', { schemaVersion: 1, event: 'preview-audit', at: new Date().toISOString(), actor: authorization.actor, planHash, requestHash: plan.requestHash, scope: plan.scope });
    result = { status: 'preview-only-no-business-writes', ...report(plan, db), planHash, requestSha: authorization.actor.requestSha };
  } else {
    const saved = await archive.get('plans', authorization.command.plan);
    invariant(saved.requestHash === requestHash(request) && hash(saved) === authorization.command.plan, 'Stored plan differs from approved request');
    const receipt = await db.doc(`dataAdminOperations/${request.id}`).get();
    if (!receipt.exists) {
      const fresh = request.operation === 'migrate' ? await prepareMigration(request, db, env) : await prepare(request, db, archive);
      invariant(hash(fresh) === authorization.command.plan, 'Source or destination changed; preview and authorize the new hash');
    }
    result = await apply(request, saved, db, archive, authorization.actor);
  }
  const publicReport = JSON.stringify({ ...result, archiveAccess }, null, 2);
  console.log(publicReport);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `\n### Data administration\n\n\`\`\`json\n${publicReport}\n\`\`\`\n`);
} catch (error) {
  // Never dump SDK response objects, source rows, access tokens, credentials or customer data.
  console.error(error instanceof Error && /^(Explicit|Plan|Operation|Field|Concurrent|Post-commit|Source|Stored|Approved|Invalid|Archive|Protected|Backup|Referenced|DEV|Exact|Registered|CLI|Authorization|Create|Expected|Environment|Destructive|Combined|Current|Snapshot|Open order)/.test(error.message) ? error.message : 'Administrative operation failed; inspect the protected audit and retry with the same request ID.');
  process.exitCode = 1;
}
