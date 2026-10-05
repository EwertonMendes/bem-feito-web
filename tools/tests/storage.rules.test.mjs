import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';
import { ref, uploadBytes, getMetadata, deleteObject } from 'firebase/storage';

const env = await initializeTestEnvironment({
  projectId: 'demo-bem-feito',
  firestore: { host: '127.0.0.1', port: 8080, rules: await readFile('firestore.rules', 'utf8') },
  storage: { host: '127.0.0.1', port: 9199, rules: await readFile('storage.rules', 'utf8') },
});
let checks = 0;
const pass = async (action) => { await assertSucceeds(action); checks++; };
const deny = async (action) => { await assertFails(action); checks++; };
try {
  await env.withSecurityRulesDisabled(async (context) => {
    await Promise.all(['owner', 'operator', 'viewer', 'disabled'].map((uid) => setDoc(doc(context.firestore(), 'users', uid), { role: uid === 'disabled' ? 'operator' : uid, active: uid !== 'disabled' })));
  });
  const upload = (context, path = 'catalog/products/test/cover.webp', size = 10, contentType = 'image/webp') => uploadBytes(ref(context.storage(), path), new Uint8Array(size), { contentType });
  const owner = env.authenticatedContext('owner');
  const operator = env.authenticatedContext('operator');
  const viewer = env.authenticatedContext('viewer');
  for (const context of [env.unauthenticatedContext(), viewer, env.authenticatedContext('missing'), env.authenticatedContext('disabled')]) await deny(upload(context));
  await pass(upload(owner));
  await pass(upload(operator));
  await pass(upload(operator, 'catalog/limit.webp', 3 * 1024 * 1024));
  await deny(upload(operator, 'catalog/too-big.webp', 3 * 1024 * 1024 + 1));
  for (const mime of ['image/svg+xml', 'text/html', 'application/javascript', 'application/octet-stream']) await deny(upload(operator, 'catalog/invalid', 10, mime));
  await deny(upload(operator, 'outside/cover.webp'));
  await pass(getMetadata(ref(viewer.storage(), 'catalog/products/test/cover.webp')));
  await deny(getMetadata(ref(env.unauthenticatedContext().storage(), 'catalog/products/test/cover.webp')));
  await deny(deleteObject(ref(viewer.storage(), 'catalog/products/test/cover.webp')));
  await pass(deleteObject(ref(operator.storage(), 'catalog/products/test/cover.webp')));
  console.log(`Storage rules: ${checks} checks passed`);
} finally { await env.cleanup(); }
