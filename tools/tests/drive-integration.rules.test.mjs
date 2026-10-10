import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, serverTimestamp, updateDoc, setLogLevel } from 'firebase/firestore';

setLogLevel('silent');
const env = await initializeTestEnvironment({
  projectId: 'demo-bem-feito',
  firestore: { rules: await readFile('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
});

const profile = (role) => ({ email: `${role}@example.test`, displayName: role, role, active: true });
const audit = (uid) => ({ createdAt: serverTimestamp(), updatedAt: serverTimestamp(), createdBy: uid, updatedBy: uid });
const image = {
  provider: 'google-drive',
  fileId: 'drive-file-id',
  mimeType: 'image/webp',
  sizeBytes: 120000,
  width: 800,
  height: 600,
  modifiedTime: '2026-10-05T20:00:00.000Z',
};
const product = {
  code: 'IMG',
  active: true,
  displayName: 'Produto com imagem',
  collectionId: 'c',
  fragranceId: 'f',
  formatId: 'fmt',
  salePriceCents: 1000,
  additionalCostCents: 0,
  averageUnitCostCents: 300,
  stock: 10,
  minimumStock: 0,
  recipe: [],
  image,
};
const integration = {
  enabled: true,
  rootFolderId: 'root',
  rootFolderName: 'Bem Feito DEV',
  folders: { products: 'fp', inputs: 'fi', kits: 'fk', additions: 'fa' },
};

try {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await Promise.all([
      setDoc(doc(db, 'users', 'owner'), profile('owner')),
      setDoc(doc(db, 'users', 'operator'), profile('operator')),
      setDoc(doc(db, 'users', 'viewer'), profile('viewer')),
      setDoc(doc(db, 'integrations', 'google-drive'), { ...integration, ...audit('owner') }),
    ]);
  });

  const owner = env.authenticatedContext('owner').firestore();
  const operator = env.authenticatedContext('operator').firestore();
  const viewer = env.authenticatedContext('viewer').firestore();
  const anonymous = env.unauthenticatedContext().firestore();

  await assertSucceeds(getDoc(doc(owner, 'integrations', 'google-drive')));
  await assertSucceeds(getDoc(doc(operator, 'integrations', 'google-drive')));
  await assertSucceeds(getDoc(doc(viewer, 'integrations', 'google-drive')));
  await assertFails(getDoc(doc(anonymous, 'integrations', 'google-drive')));

  await assertSucceeds(updateDoc(doc(owner, 'integrations', 'google-drive'), {
    rootFolderName: 'Bem Feito DEV 2',
    updatedAt: serverTimestamp(),
    updatedBy: 'owner',
  }));
  await assertFails(updateDoc(doc(operator, 'integrations', 'google-drive'), {
    rootFolderName: 'Ataque',
    updatedAt: serverTimestamp(),
    updatedBy: 'operator',
  }));
  await assertFails(setDoc(doc(operator, 'integrations', 'other'), { ...integration, ...audit('operator') }));

  await assertSucceeds(setDoc(doc(operator, 'products', 'valid-image'), { ...product, ...audit('operator') }));
  await assertFails(setDoc(doc(operator, 'products', 'bad-provider'), { ...product, image: { ...image, provider: 'other' }, ...audit('operator') }));
  await assertFails(setDoc(doc(operator, 'products', 'bad-size'), { ...product, image: { ...image, sizeBytes: 4 * 1024 * 1024 }, ...audit('operator') }));
  await assertFails(setDoc(doc(operator, 'products', 'bad-mime'), { ...product, image: { ...image, mimeType: 'text/html' }, ...audit('operator') }));
  await assertFails(setDoc(doc(operator, 'products', 'extra-image-field'), { ...product, image: { ...image, token: 'forbidden' }, ...audit('operator') }));

  console.log('Drive integration rules passed');
} finally {
  await env.cleanup();
}
