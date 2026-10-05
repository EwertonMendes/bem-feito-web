import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';

const rules = await readFile('firestore.rules', 'utf8');
const testEnv = await initializeTestEnvironment({
  projectId: 'demo-bem-feito',
  firestore: {
    rules,
    host: '127.0.0.1',
    port: 8080,
  },
});

try {
  await testEnv.clearFirestore();

  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await Promise.all([
      setDoc(doc(db, 'users', 'owner'), { active: true, role: 'owner' }),
      setDoc(doc(db, 'users', 'operator'), { active: true, role: 'operator' }),
      setDoc(doc(db, 'users', 'viewer'), { active: true, role: 'viewer' }),
      setDoc(doc(db, 'users', 'disabled'), { active: false, role: 'operator' }),
      setDoc(doc(db, 'products', 'p1'), { displayName: 'Lavanda', stock: 1 }),
    ]);
  });

  const anonymous = testEnv.unauthenticatedContext().firestore();
  const owner = testEnv.authenticatedContext('owner').firestore();
  const operator = testEnv.authenticatedContext('operator').firestore();
  const viewer = testEnv.authenticatedContext('viewer').firestore();
  const disabled = testEnv.authenticatedContext('disabled').firestore();

  await assertFails(getDoc(doc(anonymous, 'products', 'p1')));
  await assertSucceeds(getDoc(doc(viewer, 'products', 'p1')));
  await assertFails(setDoc(doc(viewer, 'products', 'p2'), { displayName: 'Pêssego' }));
  await assertSucceeds(setDoc(doc(operator, 'products', 'p2'), { displayName: 'Pêssego' }));
  await assertFails(setDoc(doc(operator, 'users', 'other'), { active: true, role: 'viewer' }));
  await assertSucceeds(setDoc(doc(owner, 'users', 'other'), { active: true, role: 'viewer' }));
  await assertFails(getDoc(doc(disabled, 'products', 'p1')));
  await assertFails(setDoc(doc(operator, 'unexpectedCollection', 'x'), { value: true }));

  console.log('Firestore rules: OK');
} finally {
  await testEnv.cleanup();
}
