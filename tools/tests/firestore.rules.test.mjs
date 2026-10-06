import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp, writeBatch, setLogLevel } from 'firebase/firestore';

setLogLevel('silent');
const env = await initializeTestEnvironment({ projectId: 'demo-bem-feito', firestore: { rules: await readFile('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 } });
let checks = 0;
const pass = async (action) => { await assertSucceeds(action); checks++; };
const deny = async (action) => { await assertFails(action); checks++; };
const profile = (role, active = true) => ({ email: `${role}@example.test`, displayName: role, role, active });
const product = { code: 'TEST', active: true, displayName: 'Produto de teste', collectionId: 'c', fragranceId: 'f', formatId: 'fmt', salePriceCents: 1000, additionalCostCents: 0, averageUnitCostCents: 300, stock: 10, minimumStock: 0, recipe: [] };
const audit = (uid) => ({ createdAt: serverTimestamp(), updatedAt: serverTimestamp(), createdBy: uid, updatedBy: uid });
const sale = { code: 'V1', businessDate: '2026-10-05', discountCents: 0, subtotalCents: 1000, totalCents: 1000, receivedCents: 0, tipCents: 0, balanceCents: 1000, paymentStatus: 'pending', status: 'active', items: [{ kind: 'product', sourceId: 'p1', quantity: 1 }], paymentIds: [], stockEffects: [] };

try {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await Promise.all([
      ...['owner', 'operator', 'viewer'].map((role) => setDoc(doc(db, 'users', role), profile(role))),
      setDoc(doc(db, 'users', 'disabled'), profile('operator', false)),
      setDoc(doc(db, 'users', 'invalid-role'), profile('admin')),
      setDoc(doc(db, 'products', 'p1'), { ...product, ...audit('operator') }),
      setDoc(doc(db, 'products', 'legacy-deficit'), { ...product, stock: -3, ...audit('migration') }),
      setDoc(doc(db, 'migrationSources', 'test-run', 'sheets', 'test'), { rowsJson: '[]' }),
    ]);
  });
  const dbs = Object.fromEntries(['owner', 'operator', 'viewer', 'disabled', 'missing', 'invalid-role'].map((uid) => [uid, env.authenticatedContext(uid).firestore()]));
  const anonymous = env.unauthenticatedContext().firestore();
  const { owner, operator, viewer } = dbs;
  for (const db of [anonymous, dbs.disabled, dbs.missing, dbs['invalid-role']]) {
    await deny(getDoc(doc(db, 'products', 'p1')));
    await deny(setDoc(doc(db, 'products', 'blocked'), { ...product, ...audit('operator') }));
  }
  for (const db of [owner, operator, viewer]) await pass(getDoc(doc(db, 'products', 'p1')));
  await pass(updateDoc(doc(operator, 'products', 'legacy-deficit'), { salePriceCents: 1200, updatedAt: serverTimestamp(), updatedBy: 'operator' }));
  await deny(updateDoc(doc(operator, 'products', 'legacy-deficit'), { stock: -4, updatedAt: serverTimestamp(), updatedBy: 'operator' }));
  await pass(updateDoc(doc(operator, 'products', 'legacy-deficit'), { stock: -2, updatedAt: serverTimestamp(), updatedBy: 'operator' }));
  await pass(updateDoc(doc(operator, 'products', 'legacy-deficit'), { stock: 0, updatedAt: serverTimestamp(), updatedBy: 'operator' }));
  await deny(updateDoc(doc(operator, 'products', 'legacy-deficit'), { stock: -1, updatedAt: serverTimestamp(), updatedBy: 'operator' }));
  await pass(getDoc(doc(owner, 'migrationSources', 'test-run', 'sheets', 'test')));
  for (const db of [operator, viewer, anonymous]) await deny(getDoc(doc(db, 'migrationSources', 'test-run', 'sheets', 'test')));
  await deny(setDoc(doc(owner, 'migrationSources', 'test-run', 'sheets', 'test'), { rowsJson: '[]' }));
  await pass(getDoc(doc(dbs.missing, 'users', 'missing')));
  await deny(getDoc(doc(viewer, 'users', 'operator')));
  await deny(setDoc(doc(viewer, 'products', 'p2'), { ...product, ...audit('viewer') }));
  await deny(updateDoc(doc(viewer, 'products', 'p1'), { stock: 1, updatedAt: serverTimestamp(), updatedBy: 'viewer' }));
  await deny(deleteDoc(doc(viewer, 'products', 'p1')));
  await pass(setDoc(doc(operator, 'products', 'p2'), { ...product, ...audit('operator') }));
  await pass(updateDoc(doc(operator, 'products', 'p2'), { stock: 9, updatedAt: serverTimestamp(), updatedBy: 'operator' }));
  await pass(setDoc(doc(operator, 'products', 'status-ok'), { ...product, stockStatus: 'ok', ...audit('operator') }));
  await deny(setDoc(doc(operator, 'products', 'status-wrong'), { ...product, stockStatus: 'low', ...audit('operator') }));
  const untrackedInput = { name: 'Sem mínimo', code: 'IU', active: true, unitId: 'u', stock: 0, minimumStock: 0, minimumStockConfigured: false, stockStatus: 'untracked', averageUnitCostCents: 100 };
  await pass(setDoc(doc(operator, 'inputs', 'status-untracked'), { ...untrackedInput, ...audit('operator') }));
  await deny(setDoc(doc(operator, 'inputs', 'status-wrong'), { ...untrackedInput, stockStatus: 'low', ...audit('operator') }));
  for (const uid of ['operator', 'viewer']) {
    await deny(updateDoc(doc(dbs[uid], 'users', uid), { role: 'owner' }));
    await deny(updateDoc(doc(dbs[uid], 'users', uid), { active: false }));
    await deny(setDoc(doc(dbs[uid], 'users', 'other-owner'), profile('owner')));
  }
  await pass(setDoc(doc(owner, 'users', 'other'), profile('viewer')));
  await deny(setDoc(doc(owner, 'users', 'bad-role'), profile('admin')));
  await deny(setDoc(doc(owner, 'users', 'bad-active'), { ...profile('viewer'), active: 'true' }));
  await deny(setDoc(doc(owner, 'users', 'extra'), { ...profile('viewer'), unexpected: true }));
  for (const [field, value] of [['salePriceCents', -1], ['salePriceCents', 0.5], ['salePriceCents', 1000000001], ['stock', -1], ['stock', 1000001], ['role', 'owner'], ['recipe', {}], ['active', 'true']]) await deny(setDoc(doc(operator, 'products', 'malformed'), { ...product, [field]: value, ...audit('operator') }));
  await deny(setDoc(doc(operator, 'products', 'wrong-actor'), { ...product, ...audit('owner') }));
  await deny(setDoc(doc(operator, 'products', 'wrong-time'), { ...product, ...audit('operator'), createdAt: new Date(0) }));
  await deny(updateDoc(doc(operator, 'products', 'p2'), { createdBy: 'owner', updatedAt: serverTimestamp(), updatedBy: 'operator' }));
  await deny(updateDoc(doc(operator, 'products', 'p2'), { createdAt: serverTimestamp(), updatedAt: serverTimestamp(), updatedBy: 'operator' }));
  await deny(updateDoc(doc(operator, 'products', 'p2'), { stock: 8, updatedAt: new Date(0), updatedBy: 'operator' }));
  await pass(setDoc(doc(operator, 'sales', 's1'), { ...sale, ...audit('operator') }));
  for (const change of [{ status: 'invalid' }, { paymentStatus: 'invalid' }, { totalCents: -1 }, { balanceCents: 999 }, { unexpected: true }, { businessDate: 'invalid' }, { items: {} }]) await deny(setDoc(doc(operator, 'sales', 'bad-sale'), { ...sale, ...change, ...audit('operator') }));
  await pass(updateDoc(doc(operator, 'sales', 's1'), { receivedCents: 500, balanceCents: 500, paymentStatus: 'partial', updatedAt: serverTimestamp(), updatedBy: 'operator' }));
  await pass(updateDoc(doc(operator, 'sales', 's1'), { status: 'cancelled', paymentStatus: 'cancelled', balanceCents: 0, updatedAt: serverTimestamp(), updatedBy: 'operator' }));
  const payment = { code: 'P1', saleId: 's1', businessDate: '2026-10-05', methodId: 'm', amountReceivedCents: 1200, appliedCents: 1000, tipCents: 200, status: 'active' };
  await pass(setDoc(doc(operator, 'payments', 'pay1'), { ...payment, ...audit('operator') }));
  await deny(setDoc(doc(operator, 'payments', 'bad-pay'), { ...payment, appliedCents: -1, ...audit('operator') }));
  await deny(setDoc(doc(operator, 'payments', 'bad-pay'), { ...payment, tipCents: 999, ...audit('operator') }));
  await pass(updateDoc(doc(operator, 'payments', 'pay1'), { status: 'reversed', updatedAt: serverTimestamp(), updatedBy: 'operator' }));
  await deny(deleteDoc(doc(operator, 'sales', 's1')));
  await deny(deleteDoc(doc(owner, 'sales', 's1')));
  for (const value of [-1, 1.5, 501]) await deny(setDoc(doc(operator, 'counters', 'sale'), { value, updatedAt: serverTimestamp() }));
  await deny(setDoc(doc(viewer, 'counters', 'sale'), { value: 1, updatedAt: serverTimestamp() }));
  await deny(setDoc(doc(operator, 'counters', 'unknown'), { value: 1, updatedAt: serverTimestamp() }));
  await pass(setDoc(doc(operator, 'counters', 'sale'), { value: 1, updatedAt: serverTimestamp() }));
  await deny(setDoc(doc(operator, 'counters', 'payment'), { value: 1, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
  for (const counter of ['payment', 'production', 'expense', 'stockAdjustment']) {
    await pass(setDoc(doc(operator, 'counters', counter), { value: 1, updatedAt: serverTimestamp() }));
  }
  await deny(updateDoc(doc(operator, 'counters', 'sale'), { value: 0, updatedAt: serverTimestamp() }));
  await deny(updateDoc(doc(operator, 'counters', 'sale'), { value: 502, updatedAt: serverTimestamp() }));
  await deny(updateDoc(doc(operator, 'counters', 'sale'), { value: 2, createdBy: 'owner', updatedAt: serverTimestamp() }));
  await deny(deleteDoc(doc(owner, 'counters', 'sale')));
  for (const db of [owner, operator, viewer, anonymous]) await deny(setDoc(doc(db, 'migrationRuns', 'r'), { source: 'test' }));
  await deny(setDoc(doc(operator, 'unexpectedCollection', 'x'), { value: true }));

  // Shared read-optimization metadata stays readable to active users but writable only by operators.
  for (const db of [owner, operator, viewer]) {
    await pass(getDoc(doc(db, 'system', 'data-revisions')));
    await pass(getDoc(doc(db, 'system', 'read-optimization')));
  }
  await deny(getDoc(doc(anonymous, 'system', 'data-revisions')));
  await deny(getDoc(doc(anonymous, 'system', 'read-optimization')));

  await pass(setDoc(doc(operator, 'system', 'data-revisions'), {
    catalog: { source: 'rules-test', at: serverTimestamp() },
    references: { source: 'rules-test', at: serverTimestamp() },
    sales: { source: 'rules-test', at: serverTimestamp() },
  }));
  await pass(updateDoc(doc(operator, 'system', 'data-revisions'), {
    finance: { source: 'rules-test', at: serverTimestamp() },
  }));
  await deny(setDoc(doc(viewer, 'system', 'data-revisions'), {
    catalog: { source: 'viewer', at: serverTimestamp() },
  }));
  await deny(updateDoc(doc(operator, 'system', 'data-revisions'), {
    catalog: { source: '', at: serverTimestamp() },
  }));
  await deny(updateDoc(doc(operator, 'system', 'data-revisions'), {
    catalog: { source: 'stale', at: new Date(0) },
  }));

  await pass(setDoc(doc(operator, 'system', 'read-optimization'), {
    version: 1,
    updatedAt: serverTimestamp(),
    updatedBy: 'operator',
  }));
  await pass(updateDoc(doc(operator, 'system', 'read-optimization'), {
    version: 2,
    updatedAt: serverTimestamp(),
    updatedBy: 'operator',
  }));
  await deny(updateDoc(doc(operator, 'system', 'read-optimization'), {
    version: 1,
    updatedAt: serverTimestamp(),
    updatedBy: 'operator',
  }));
  await deny(updateDoc(doc(viewer, 'system', 'read-optimization'), {
    version: 3,
    updatedAt: serverTimestamp(),
    updatedBy: 'viewer',
  }));
  await deny(updateDoc(doc(operator, 'system', 'read-optimization'), {
    version: 3,
    updatedAt: serverTimestamp(),
    updatedBy: 'owner',
  }));
  // Exercise each collection schema with both legitimate and malformed writes.
  const named = { name: 'DEV fixture', active: true };
  const fixtures = {
    collections: named, units: named, paymentMethods: named, expenseCategories: named,
    fragrances: { ...named, collectionId: 'c' }, formats: { ...named, approximateWeightGrams: 100 },
    expenseTypes: { ...named, kind: 'operating-expense' },
    formatPrices: { collectionId: 'c', formatId: 'fmt', priceCents: 1000, active: true },
    inputs: { ...named, code: 'I1', unitId: 'u', stock: 10, minimumStock: 1, averageUnitCostCents: 100 },
    products: product,
    kits: { ...named, priceCents: 1000, components: [] },
    additions: { ...named, category: 'fixture', priceCents: 100, components: [] },
    expenses: { code: 'M1', businessDate: '2026-10-05', kind: 'input-purchase', inputId: 'i', quantity: 2, amountCents: 1000 },
    productions: { code: 'PR1', businessDate: '2026-10-05', productId: 'p1', productName: 'Fixture', quantity: 1, unitCostCents: 100, totalCostCents: 100, costPending: false, consumptions: [] },
    stockAdjustments: { code: 'AJ1', businessDate: '2026-10-05', itemType: 'product', itemId: 'p1', quantityDelta: 1, reason: 'Fixture' },
    stockMovements: { businessDate: '2026-10-05', itemType: 'product', itemId: 'p1', quantityDelta: 1, unitCostCents: 100, totalCostCents: 100, sourceType: 'adjustment', sourceId: 'a1' },
  };
  for (const [collection, payload] of Object.entries(fixtures)) {
    await pass(setDoc(doc(operator, collection, 'schema-fixture'), { ...payload, ...audit('operator') }));
    await deny(setDoc(doc(operator, collection, 'bad-schema'), { ...payload, unexpected: true, ...audit('operator') }));
    const missing = { ...payload }; delete missing[Object.keys(payload)[0]];
    await deny(setDoc(doc(operator, collection, 'missing-field'), { ...missing, ...audit('operator') }));
    const numericField = Object.keys(payload).find((field) => field.endsWith('Cents') || ['quantity', 'quantityDelta', 'approximateWeightGrams'].includes(field));
    if (numericField) await deny(setDoc(doc(operator, collection, 'bad-number'), { ...payload, [numericField]: numericField === 'quantityDelta' ? 0 : -1, ...audit('operator') }));
  }
  await deny(setDoc(doc(operator, 'expenseTypes', 'bad-kind'), { ...fixtures.expenseTypes, kind: 'invalid', ...audit('operator') }));
  await deny(setDoc(doc(operator, 'stockMovements', 'bad-source'), { ...fixtures.stockMovements, sourceType: 'invalid', ...audit('operator') }));
  await deny(setDoc(doc(operator, 'productions', 'bad-flag'), { ...fixtures.productions, costPending: 'false', ...audit('operator') }));
  const batch = writeBatch(operator);
  batch.update(doc(operator, 'products', 'p2'), { stock: 8, updatedAt: serverTimestamp(), updatedBy: 'operator' });
  batch.set(doc(operator, 'users', 'forbidden'), profile('owner'));
  await deny(batch.commit());
  if ((await getDoc(doc(operator, 'products', 'p2'))).data().stock !== 9) throw new Error('Denied batch changed stock');
  checks++;
  console.log(`Firestore rules: ${checks} checks passed`);
} finally { await env.cleanup(); }
