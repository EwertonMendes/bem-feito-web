import '@angular/compiler';
import { Injector, runInInjectionContext } from '@angular/core';
import { initializeTestEnvironment, RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { collection, doc, Firestore, getDoc, getDocs, serverTimestamp, setDoc, Transaction, WriteBatch } from 'firebase/firestore';
import { AuthService } from '../../src/app/core/auth/auth.service';
import { DataRevisionService } from '../../src/app/core/firebase/data-revision.service';
import { ReadOptimizationBackfillService } from '../../src/app/core/migrations/read-optimization-backfill.service';
import { FIRESTORE } from '../../src/app/core/firebase/firebase.providers';
import { SalesRepository } from '../../src/app/core/repositories/sales.repository';
import { ProductionRepository } from '../../src/app/core/repositories/production.repository';
import { FinanceRepository } from '../../src/app/core/repositories/finance.repository';
import { InventoryRepository } from '../../src/app/core/repositories/inventory.repository';

let env: RulesTestEnvironment;
let db: Firestore;
let injector: Injector;
let sales: SalesRepository;
let production: ProductionRepository;
let finance: FinanceRepository;
let inventory: InventoryRepository;
const day = '2026-10-05';
const audit = () => ({ createdAt: serverTimestamp(), updatedAt: serverTimestamp(), createdBy: 'operator', updatedBy: 'operator' });
const draft = (businessDate = day) => ({ businessDate, customerName: 'TEST ONLY', discountCents: 0, lines: [{ kind: 'product' as const, sourceId: 'p', quantity: 1 }], payments: [] });
const data = async (name: string, id: string) => (await getDoc(doc(db, name, id))).data();
const count = async (name: string) => (await getDocs(collection(db, name))).size;
const purchase = (businessDate = day) => ({ businessDate, kind: 'input-purchase' as const, inputId: 'i', unitId: 'u', quantity: 5, amountCents: 500 });

beforeAll(async () => {
  if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080') throw new Error('Transaction tests require the demo emulator.');
  env = await initializeTestEnvironment({ projectId: 'demo-bem-feito', firestore: { host: '127.0.0.1', port: 8080, rules: await readFile('firestore.rules', 'utf8') } });
});
beforeEach(async () => {
  injector?.destroy();
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async context => {
    const seed = context.firestore();
    await Promise.all([
      setDoc(doc(seed, 'users', 'operator'), { email: 'test@example.test', displayName: 'Test', role: 'operator', active: true }),
      setDoc(doc(seed, 'inputs', 'i'), { code: 'TEST-I', name: 'TEST INPUT', active: true, unitId: 'u', trackingMode: 'exact', stock: 20, minimumStock: 0, minimumStockConfigured: true, averageUnitCostCents: 100, ...audit() }),
      setDoc(doc(seed, 'inputs', 'i-est'), { code: 'TEST-I-EST', name: 'TEST ESTIMATED INPUT', active: true, unitId: 'u', trackingMode: 'estimated', stock: 1, minimumStock: 0, minimumStockConfigured: true, averageUnitCostCents: 200, ...audit() }),
      setDoc(doc(seed, 'inputs', 'i-un'), { code: 'TEST-I-UN', name: 'TEST UNTRACKED INPUT', active: true, unitId: 'u', trackingMode: 'untracked', stock: 0, minimumStock: 0, minimumStockConfigured: false, averageUnitCostCents: 0, ...audit() }),
      setDoc(doc(seed, 'products', 'p'), { code: 'TEST-P', displayName: 'TEST PRODUCT', active: true, collectionId: 'c', fragranceId: 'f', formatId: 'fmt', salePriceCents: 1000, additionalCostCents: 0, averageUnitCostCents: 100, stock: 10, minimumStock: 0, recipe: [{ inputId: 'i', unitId: 'u', quantity: 2 }, { inputId: 'i', unitId: 'u', quantity: 3 }], ...audit() }),
      setDoc(doc(seed, 'products', 'p-est'), { code: 'TEST-P-EST', displayName: 'TEST ESTIMATED PRODUCT', active: true, collectionId: 'c', fragranceId: 'f', formatId: 'fmt', salePriceCents: 3000, additionalCostCents: 0, averageUnitCostCents: 0, stock: 0, minimumStock: 0, recipe: [{ inputId: 'i-est', unitId: 'u', quantity: 10 }], ...audit() }),
      setDoc(doc(seed, 'kits', 'k'), { active: true, name: 'TEST KIT', priceCents: 1800, components: [{ id: 'slot', formatId: 'fmt', quantity: 2, order: 1 }], ...audit() }),
      setDoc(doc(seed, 'additions', 'a'), { active: true, name: 'TEST ADDITION', category: 'TEST', priceCents: 200, components: [{ id: 'part', inputId: 'i', unitId: 'u', quantity: 1, order: 1 }], ...audit() }),
    ]);
  });
  db = env.authenticatedContext('operator').firestore({ ignoreUndefinedProperties: true });
  injector = Injector.create({
    providers: [
      { provide: FIRESTORE, useValue: db },
      { provide: AuthService, useValue: { user: () => ({ uid: 'operator' }), canOperate: () => true } },
      {
        provide: DataRevisionService,
        useValue: {
          touchTransaction: (transaction: Transaction, ...domains: string[]) => {
            const patch = Object.fromEntries(domains.map((domain) => [
              domain,
              { source: 'transaction-test', at: serverTimestamp() },
            ]));
            transaction.set(doc(db, 'system', 'data-revisions'), patch, { merge: true });
          },
          touchBatch: (batch: WriteBatch, ...domains: string[]) => {
            const patch = Object.fromEntries(domains.map((domain) => [
              domain,
              { source: 'transaction-test', at: serverTimestamp() },
            ]));
            batch.set(doc(db, 'system', 'data-revisions'), patch, { merge: true });
          },
        },
      },
    ],
  });
  sales = runInInjectionContext(injector, () => new SalesRepository());
  production = runInInjectionContext(injector, () => new ProductionRepository());
  finance = runInInjectionContext(injector, () => new FinanceRepository());
  inventory = runInInjectionContext(injector, () => new InventoryRepository());
});
afterAll(async () => { injector?.destroy(); await env?.cleanup(); });

describe('Actual repositories against restrictive emulator rules', () => {
  it('creates a sale with product, kit, addition, multiple methods and tip; cancellation restores stocks once', async () => {
    const created = await sales.create({ ...draft(), lines: [
      { kind: 'product', sourceId: 'p', quantity: 1 },
      { kind: 'kit', sourceId: 'k', quantity: 1, componentProductIds: ['p', 'p'] },
      { kind: 'addition', sourceId: 'a', quantity: 2 },
    ], payments: [{ methodId: 'cash', amountReceivedCents: 1000 }, { methodId: 'pix', amountReceivedCents: 2300 }] });
    const id = created.sale.id;
    expect(created.sale).toMatchObject({ cogsCents: 1700, itemsSold: 3, missingCostItems: 0, analyticsVersion: 1 });
    expect(created.stockChanges).toHaveLength(2);
    expect(await data('products', 'p')).toMatchObject({ stock: 7 });
    expect(await data('inputs', 'i')).toMatchObject({ stock: 18 });
    expect(await data('sales', id)).toMatchObject({ totalCents: 3200, receivedCents: 3200, tipCents: 100, balanceCents: 0, paymentStatus: 'paid' });
    expect(await count('payments')).toBe(2);
    await sales.cancel(id);
    expect(await data('products', 'p')).toMatchObject({ stock: 10 });
    expect(await data('inputs', 'i')).toMatchObject({ stock: 20 });
    expect(await data('sales', id)).toMatchObject({ status: 'cancelled', paymentStatus: 'cancelled', balanceCents: 0 });
    await sales.cancel(id);
    expect(await data('products', 'p')).toMatchObject({ stock: 10 });
  });
  it('receives a pending sale, reverses the receipt and accepts partial payment', async () => {
    const id = (await sales.create(draft())).sale.id;
    expect(await data('sales', id)).toMatchObject({ paymentStatus: 'pending', balanceCents: 1000 });
    await sales.addPayment(id, day, 'pix', 1200);
    const sale = (await data('sales', id))!;
    expect(sale).toMatchObject({ paymentStatus: 'paid', receivedCents: 1000, tipCents: 200 });
    await sales.reversePayment(sale['paymentIds'][0]);
    expect(await data('sales', id)).toMatchObject({ paymentStatus: 'pending', receivedCents: 0, tipCents: 0, balanceCents: 1000 });
    await sales.addPayment(id, day, 'cash', 400);
    expect(await data('sales', id)).toMatchObject({ paymentStatus: 'partial', balanceCents: 600 });
    const receivables = await sales.receivablePage();
    expect(receivables.items.map((item) => item.id)).toContain(id);
  });
  it('aggregates repeated recipe inputs and records costs and both stock movements', async () => {
    const id = (await production.create('p', 2, day)).production.id;
    expect(await data('inputs', 'i')).toMatchObject({ stock: 10 });
    expect(await data('products', 'p')).toMatchObject({ stock: 12 });
    expect(await data('productions', id)).toMatchObject({ totalCostCents: 1000, unitCostCents: 500, consumptions: [{ inputId: 'i', quantity: 10 }] });
    expect(await count('stockMovements')).toBe(2);
  });
  it('uses estimated inputs for cost without consuming or blocking their physical balance', async () => {
    const created = await production.create('p-est', 2, day);
    expect(created.production).toMatchObject({ unitCostCents: 2000, totalCostCents: 4000, costPending: false });
    expect(await data('inputs', 'i-est')).toMatchObject({ stock: 0 });
    expect(await data('products', 'p-est')).toMatchObject({ stock: 2, averageUnitCostCents: 2000 });
    expect(await count('stockMovements')).toBe(2);
  });

  it('updates cost for an untracked input without creating fake physical inventory', async () => {
    await finance.createExpense({ businessDate: day, kind: 'input-purchase', inputId: 'i-un', unitId: 'u', quantity: 5, amountCents: 500 });
    expect(await data('inputs', 'i-un')).toMatchObject({
      stock: 0,
      averageUnitCostCents: 100,
      costBasisQuantity: 5,
      costBasisValueCents: 500,
    });
    expect(await count('stockMovements')).toBe(0);
    await expect(inventory.adjust('input', 'i-un', 1, 'TEST ONLY', day)).rejects.toThrow('não controla saldo');
    expect(await count('stockAdjustments')).toBe(0);
  });

  it('records purchases, expenses and positive/negative inventory adjustments', async () => {
    await finance.createExpense(purchase());
    expect(await data('inputs', 'i')).toMatchObject({ stock: 25, averageUnitCostCents: 100 });
    await finance.createExpense({ businessDate: day, kind: 'operating-expense', amountCents: 1234 });
    await inventory.adjust('input', 'i', -2, 'TEST ONLY', day);
    await inventory.adjust('product', 'p', 1, 'TEST ONLY', day);
    expect(await data('inputs', 'i')).toMatchObject({ stock: 23 });
    expect(await data('products', 'p')).toMatchObject({ stock: 11 });
    expect(await count('expenses')).toBe(2);
    expect(await count('stockAdjustments')).toBe(2);
  });
  it('rejects inventory adjustments that would make stock negative without partial writes', async () => {
    await expect(inventory.adjust('product', 'p', -11, 'TEST ONLY', day)).rejects.toThrow('Estoque insuficiente');
    expect(await data('products', 'p')).toMatchObject({ stock: 10 });
    expect(await count('stockAdjustments')).toBe(0);
    expect(await count('stockMovements')).toBe(0);
    expect(await data('counters', 'stockAdjustment')).toBeUndefined();
  });
  for (const operation of ['sale', 'production', 'purchase', 'adjustment'] as const) {
    it(`rolls back every staged document when rules reject ${operation}`, async () => {
      const action = operation === 'sale' ? sales.create(draft('invalid'))
        : operation === 'production' ? production.create('p', 1, 'invalid')
        : operation === 'purchase' ? finance.createExpense(purchase('invalid'))
        : inventory.adjust('input', 'i', -1, 'TEST ONLY', 'invalid');
      await expect(action).rejects.toBeDefined();
      expect(await data('products', 'p')).toMatchObject({ stock: 10 });
      expect(await data('inputs', 'i')).toMatchObject({ stock: 20 });
      for (const name of ['sales', 'payments', 'productions', 'expenses', 'stockAdjustments', 'stockMovements', 'counters']) {
        expect(await count(name)).toBe(0);
      }
      expect(await data('system', 'data-revisions')).toBeUndefined();
    });
  }
  it('rolls back sale totals and counter when a receipt is rejected', async () => {
    const id = (await sales.create(draft())).sale.id;
    await expect(sales.addPayment(id, 'invalid', 'pix', 500)).rejects.toBeDefined();
    expect(await data('sales', id)).toMatchObject({ receivedCents: 0, balanceCents: 1000, paymentIds: [] });
    expect(await count('payments')).toBe(0);
    expect(await data('counters', 'payment')).toBeUndefined();
  });
  it('rolls back reversal and cancellation if a linked active payment is malformed', async () => {
    const id = (await sales.create({ ...draft(), payments: [{ methodId: 'pix', amountReceivedCents: 1000 }] })).sale.id;
    const paymentId = (await data('sales', id))!['paymentIds'][0];
    await env.withSecurityRulesDisabled(async context => {
      const ref = doc(context.firestore(), 'payments', paymentId);
      await setDoc(ref, { methodId: '' }, { merge: true });
    });
    await expect(sales.reversePayment(paymentId)).rejects.toBeDefined();
    await expect(sales.cancel(id)).rejects.toBeDefined();
    expect(await data('sales', id)).toMatchObject({ status: 'active', receivedCents: 1000 });
    expect(await data('payments', paymentId)).toMatchObject({ status: 'active' });
    expect(await data('products', 'p')).toMatchObject({ stock: 9 });
    expect(await count('stockMovements')).toBe(1);
  });
  it('backfills read-optimization fields in security-rules-safe chunks', async () => {
    await env.withSecurityRulesDisabled(async context => {
      const seed = context.firestore();
      await Promise.all(Array.from({ length: 10 }, (_, index) =>
        setDoc(doc(seed, 'products', `legacy-${index}`), {
          code: `LEGACY-${index}`,
          displayName: `LEGACY PRODUCT ${index}`,
          active: true,
          collectionId: 'c',
          fragranceId: 'f',
          formatId: 'fmt',
          salePriceCents: 1000,
          additionalCostCents: 0,
          averageUnitCostCents: 100,
          stock: index + 1,
          minimumStock: 0,
          recipe: [],
          ...audit(),
        })
      ));
    });

    const backfill = runInInjectionContext(injector, () => new ReadOptimizationBackfillService());
    await expect(backfill.ensure()).resolves.toBeUndefined();

    expect(await data('system', 'read-optimization')).toMatchObject({ version: 1, updatedBy: 'operator' });
    expect(await data('products', 'p')).toMatchObject({ stockStatus: 'ok' });
    expect(await data('inputs', 'i')).toMatchObject({ stockStatus: 'ok' });
    for (let index = 0; index < 10; index += 1) {
      expect(await data('products', `legacy-${index}`)).toMatchObject({ stockStatus: 'ok' });
    }
  });

});
