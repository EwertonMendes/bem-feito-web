import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080') {
  throw new Error('Refusing to seed anything other than localhost Firestore emulator.');
}

const response = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'qa-e2e@example.test', password: 'LocalEmulatorPass123!', returnSecureToken: true }),
});
const body = await response.json();
if (!response.ok || !body.localId) throw new Error('Auth emulator seed failed: ' + JSON.stringify(body));

const app = initializeApp({ projectId: 'demo-bem-feito' });
const db = getFirestore(app);
const audit = {
  createdAt: FieldValue.serverTimestamp(),
  updatedAt: FieldValue.serverTimestamp(),
  createdBy: body.localId,
  updatedBy: body.localId,
};
const batch = db.batch();
batch.set(db.doc('users/' + body.localId), { email: 'qa-e2e@example.test', role: 'owner', active: true, displayName: 'QA Playwright' });
batch.set(db.doc('units/u'), { name: 'un', abbreviation: 'un', active: true, ...audit });
batch.set(db.doc('units/ml'), { name: 'ml', abbreviation: 'ml', active: true, ...audit });
batch.set(db.doc('inputs/qa-packaging'), {
  code: 'INS-QA-PACK', name: 'TESTE QA - Embalagem', unitId: 'u', active: true,
  trackingMode: 'exact', stock: 8, minimumStock: 2, minimumStockConfigured: true,
  averageUnitCostCents: 100, stockStatus: 'ok', ...audit,
});
batch.set(db.doc('inputs/qa-essence'), {
  code: 'INS-QA-ESS', name: 'TESTE QA - Essência', unitId: 'ml', active: true,
  trackingMode: 'estimated', stock: 5.5, minimumStock: 1, minimumStockConfigured: true,
  averageUnitCostCents: 50, stockStatus: 'ok', ...audit,
});
batch.set(db.doc('inputs/qa-tape'), {
  code: 'INS-QA-TAPE', name: 'TESTE QA - Fita', unitId: 'u', active: true,
  trackingMode: 'untracked', stock: 0, minimumStock: 0, minimumStockConfigured: false,
  averageUnitCostCents: 50, stockStatus: 'ok', ...audit,
});
batch.set(db.doc('products/qa-product'), {
  code: 'PROD-QA', displayName: 'TESTE QA - Produto', collectionId: 'qa-c', fragranceId: 'qa-f',
  formatId: 'qa-format', active: true, stock: 3, minimumStock: 1, stockStatus: 'ok',
  salePriceCents: 2000, additionalCostCents: 0, averageUnitCostCents: 600, recipe: [], ...audit,
});
await batch.commit();
console.log('Auth + Firestore emulator seeded: exact=8, estimated=5.5, untracked=0, product=3.');
