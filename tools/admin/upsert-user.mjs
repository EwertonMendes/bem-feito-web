import { applicationDefault, cert, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const [emailArg, roleArg = 'owner'] = process.argv.slice(2);
const email = emailArg?.trim().toLowerCase();
if (!email) throw new Error('Uso: node tools/admin/upsert-user.mjs email@exemplo.com owner|operator|viewer');
if (!['owner', 'operator', 'viewer'].includes(roleArg)) throw new Error('Role inválida.');
const projectId = process.env.FIREBASE_PROJECT_ID;
if (!projectId) throw new Error('Defina FIREBASE_PROJECT_ID.');
const credentialPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
const credential = credentialPath
  ? cert(JSON.parse(await readFile(resolve(credentialPath), 'utf8')))
  : applicationDefault();
initializeApp({ credential, projectId });
const auth = getAuth();
const db = getFirestore();
const user = await auth.getUserByEmail(email);
await db.collection('users').doc(user.uid).set({
  email: user.email ?? email,
  displayName: user.displayName ?? user.email ?? 'Usuário',
  photoURL: user.photoURL ?? null,
  role: roleArg,
  active: true,
  updatedAt: FieldValue.serverTimestamp(),
}, { merge: true });
console.log(`${email} configurado como ${roleArg} no projeto ${projectId}.`);
