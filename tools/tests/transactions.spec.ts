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
import { ProductionCorrectionRepository } from '../../src/app/core/repositories/production-correction.repository';
import { FinanceRepository } from '../../src/app/core/repositories/finance.repository';
import { ExpenseCorrectionRepository } from '../../src/app/core/repositories/expense-correction.repository';
import { CashManagementRepository } from '../../src/app/core/repositories/cash-management.repository';
import { SaleCorrectionRepository } from '../../src/app/core/repositories/sale-correction.repository';
import { AdvancedSaleCorrectionRepository } from '../../src/app/core/repositories/advanced-sale-correction.repository';
import { saleCorrectionSignature } from '../../src/app/domain/logic/sale-correction';
import { InventoryRepository } from '../../src/app/core/repositories/inventory.repository';

let env: RulesTestEnvironment;
let db: Firestore;
let injector: Injector;
let sales: SalesRepository;
let production: ProductionRepository;
let productionCorrection: ProductionCorrectionRepository;
let finance: FinanceRepository;
let corrections: ExpenseCorrectionRepository;
let cash: CashManagementRepository;
let saleCorrections: SaleCorrectionRepository;
let advancedCorrections: AdvancedSaleCorrectionRepository;
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
  productionCorrection = runInInjectionContext(injector, () => new ProductionCorrectionRepository());
  finance = runInInjectionContext(injector, () => new FinanceRepository());
  corrections = runInInjectionContext(injector, () => new ExpenseCorrectionRepository());
  cash = runInInjectionContext(injector, () => new CashManagementRepository());
  saleCorrections = runInInjectionContext(injector, () => new SaleCorrectionRepository());
  advancedCorrections = runInInjectionContext(injector, () => new AdvancedSaleCorrectionRepository());
  inventory = runInInjectionContext(injector, () => new InventoryRepository());
});
afterAll(async () => { injector?.destroy(); await env?.cleanup(); });

describe('Actual repositories against restrictive emulator rules', () => {
  it('atomically corrects sold soap quantity and price while preserving historic costs', async () => {
    const created=await sales.create({...draft(),lines:[{kind:'product',sourceId:'p',quantity:2}]});
    const sale=created.sale;
    const {saleCorrectionSignature}=await import('../../src/app/domain/logic/sale-correction');
    const result=await saleCorrections.correctProductLines(sale.id,{
      expectedSignature:saleCorrectionSignature(sale),
      lines:[{lineId:sale.items[0]!.id,quantity:3,unitPriceCents:900}],
      discountCents:100,reason:'Corrigir quantidades e preço',
    });
    expect(result.sale).toMatchObject({totalCents:2600,balanceCents:2600,discountCents:100});
    expect(result.sale.items[0]).toMatchObject({quantity:3,unitPriceCents:900});
    expect(await data('products','p')).toMatchObject({stock:7});
    expect(await count('saleCorrections')).toBe(1);
    expect(await count('stockMovements')).toBe(2);
    await expect(saleCorrections.correctProductLines(sale.id,{
      expectedSignature:saleCorrectionSignature(sale),
      lines:[{lineId:sale.items[0]!.id,quantity:2,unitPriceCents:1000}],
      discountCents:0,reason:'Tentar revisão antiga',
    })).rejects.toThrow('mudou');
  });

  it('rejects corrections without physical free stock and rolls back changes', async () => {
    const created=await sales.create({...draft(),lines:[{kind:'product',sourceId:'p',quantity:2}]});
    const {saleCorrectionSignature}=await import('../../src/app/domain/logic/sale-correction');
    await expect(saleCorrections.correctProductLines(created.sale.id,{
      expectedSignature:saleCorrectionSignature(created.sale),
      lines:[{lineId:created.sale.items[0]!.id,quantity:50,unitPriceCents:1000}],
      discountCents:0,reason:'Quantidade errada',
    })).rejects.toThrow('Estoque livre');
    expect(await data('products','p')).toMatchObject({stock:8});
    expect(await data('sales',created.sale.id)).toMatchObject({totalCents:2000});
    expect(await count('saleCorrections')).toBe(0);
  });

  it('does not allow edited total smaller than applied payments', async () => {
    const created=await sales.create({...draft(),lines:[{kind:'product',sourceId:'p',quantity:2}],
      payments:[{methodId:'pix',amountReceivedCents:1500}]});
    const {saleCorrectionSignature}=await import('../../src/app/domain/logic/sale-correction');
    await expect(saleCorrections.correctProductLines(created.sale.id,{
      expectedSignature:saleCorrectionSignature(created.sale),
      lines:[{lineId:created.sale.items[0]!.id,quantity:1,unitPriceCents:100}],
      discountCents:0,reason:'Preço corrigido',
    })).rejects.toThrow('pagamentos');
    expect(await data('products','p')).toMatchObject({stock:8});
    expect(await count('saleCorrections')).toBe(0);
  });

  it('audits a customer correction without touching inventory, totals or payments', async () => {
    const created=await sales.create(draft());
    const beforeStock=(await data('products','p'))?.['stock'];
    const corrected=await saleCorrections.correctMetadata(created.sale.id,{
      customerName:'Cliente Atualizado',dueDate:'2026-10-20',notes:'Retirada combinada',
      reason:'Cliente informou nome errado',
    });
    expect(corrected.customerName).toBe('Cliente Atualizado');
    expect(await data('sales',created.sale.id)).toMatchObject({
      customerName:'Cliente Atualizado',customerSearchKey:'cliente atualizado',
      dueDate:'2026-10-20',notes:'Retirada combinada',
      totalCents:1000,
    });
    expect((await data('products','p'))?.['stock']).toBe(beforeStock);
    expect(await count('saleCorrections')).toBe(1);
    await expect(saleCorrections.correctMetadata(created.sale.id,{
      customerName:'Cliente Atualizado',dueDate:'2026-10-20',notes:'Retirada combinada',reason:'Repetição',
    })).rejects.toThrow('Nenhuma alteração');
  });


  it('requires a specific equipment name and preserves it across audited corrections', async () => {
    await expect(finance.createExpense({
      businessDate: day, kind: 'equipment', amountCents: 2790,
    })).rejects.toThrow('nome do equipamento');
    const created = await finance.createExpense({
      businessDate: day, kind: 'equipment', amountCents: 2790,
      itemName: 'Molde silicone floral 90 g',
    });
    expect(await data('expenses', created.expense.id)).toMatchObject({
      itemName: 'Molde silicone floral 90 g', amountCents: 2790, kind: 'equipment',
    });
    const corrected = await corrections.correct(created.expense.id, {
      businessDate: day, kind: 'equipment', amountCents: 2790,
      itemName: 'Molde floral com seis cavidades',
    }, 'Corrigir descrição do equipamento');
    expect(corrected.expense.itemName).toBe('Molde floral com seis cavidades');
    expect(await data('expenses', created.expense.id)).toMatchObject({
      itemName: 'Molde floral com seis cavidades', amountCents: 2790,
    });
    expect(await count('expenseCorrections')).toBe(1);
    expect(await count('stockMovements')).toBe(0);
  });

  it('corrects third-party payment source without retaining the previous payer', async () => {
    const result = await finance.createExpense({
      businessDate: day, kind: 'operating-expense', amountCents: 500,
      fundingType: 'third-party', paidBy: 'Terceiro Teste', reimbursable: true,
    });
    expect(result.expense).toMatchObject({ fundingType: 'third-party', bankDebitCents: 0 });
    await corrections.correct(result.expense.id, {
      businessDate: day, kind: 'operating-expense', amountCents: 700,
      fundingType: 'business', reimbursable: false,
    }, 'Corrigir origem do pagamento');
    expect(await data('expenses', result.expense.id)).toMatchObject({
      bankDebitCents: 700, amountCents: 700, fundingType: 'business', status: 'active',
    });
    expect(await data('expenses', result.expense.id)).not.toHaveProperty('paidBy');
    await corrections.cancel(result.expense.id, 'Registro duplicado no teste');
    expect(await data('expenses', result.expense.id)).toMatchObject({
      status: 'cancelled', amountCents: 0, cancelledAmountCents: 700, bankDebitCents: 0,
    });
    expect(await count('expenseCorrections')).toBe(2);
  });

  it('corrects and cancels a received purchase without changing other inventory', async () => {
    const purchase = await finance.createPurchaseBatch({
      businessDate: day, fundingType: 'business', receiptStatus: 'received',
      items: [{ inputId: 'i', unitId: 'u', quantity: 2, amountCents: 200 }],
    });
    expect(await data('inputs', 'i')).toMatchObject({ stock: 22, costBasisValueCents: 2200 });
    await corrections.correct(purchase.expense.id, {
      businessDate: day, fundingType: 'business', receiptStatus: 'received',
      items: [{ inputId: 'i', unitId: 'u', quantity: 3, amountCents: 300 }],
    }, 'Quantidade informada incorreta');
    expect(await data('inputs', 'i')).toMatchObject({ stock: 23, costBasisValueCents: 2300 });
    await corrections.cancel(purchase.expense.id, 'Compra de teste duplicada');
    expect(await data('inputs', 'i')).toMatchObject({ stock: 20, costBasisValueCents: 2000 });
    expect(await data('expenses', purchase.expense.id)).toMatchObject({
      amountCents: 0, cancelledAmountCents: 300, bankDebitCents: 0, status: 'cancelled',
    });
    expect(await count('stockMovements')).toBe(3);
    expect(await count('expenseCorrections')).toBe(2);
  });

  it('records and reverses capital independently of sales and reconciled balance references', async () => {
    const created = await cash.createMovement({
      kind: 'contribution', businessDate: day, amountCents: 5000,
      accountName: 'Conta principal', partyName: 'Terceiro Teste',
    });
    expect(await data('cashMovements', created.id)).toMatchObject({ status: 'active', impactCents: 5000 });
    const check = await cash.confirmBalance({ businessDate: day, accountName: 'Conta principal', balanceCents: 5800 });
    expect(await data('cashBalanceChecks', check.id)).toMatchObject({ balanceCents: 5800 });
    const reversed = await cash.reverseMovement(created.id, 'Lançamento repetido no teste');
    expect(reversed.impactCents).toBe(0);
    expect(await data('cashMovements', created.id)).toMatchObject({ status: 'reversed', impactCents: 0 });
    await expect(cash.reverseMovement(created.id, 'Segunda tentativa')).rejects.toThrow('estornada');
    expect(await count('sales')).toBe(0);
    expect(await count('expenses')).toBe(0);
  });

  it('keeps a future order off physical stock and releases commitments on cancellation', async () => {
    const created = await sales.create({ ...draft(), fulfillmentStatus: 'in-production', lines: [{ kind: 'product', sourceId: 'p', quantity: 50 }] });
    expect(created.sale).toMatchObject({ fulfillmentStatus: 'in-production', stockApplied: false, paymentStatus: 'pending' });
    expect(await data('products', 'p')).toMatchObject({ stock: 10, committedStock: 50, reservedPhysicalStock: 0 });
    await expect(sales.advanceFulfillment(created.sale.id, 'ready')).rejects.toThrow('faltam');
    await sales.cancel(created.sale.id);
    expect(await data('products', 'p')).toMatchObject({ stock: 10, committedStock: 0, reservedPhysicalStock: 0 });
    expect(await count('stockMovements')).toBe(0);
  });

  it('moves newly available physical stock into an existing order on ready transition', async () => {
    const created = await sales.create({ ...draft(), fulfillmentStatus: 'in-production',
      lines: [{ kind: 'product', sourceId: 'p', quantity: 2 }] });
    expect(await data('products', 'p')).toMatchObject({ stock: 10, committedStock: 2, reservedPhysicalStock: 0 });
    await expect(sales.advanceFulfillment(created.sale.id, 'ready')).rejects.toThrow('alocadas');
    await sales.allocateOrderLine(created.sale.id, created.sale.items[0]!.id, 2);
    expect(await count('orderAllocationHistory')).toBe(1);
    await expect(sales.allocateOrderLine(created.sale.id, created.sale.items[0]!.id, 1)).rejects.toThrow();
    await sales.advanceFulfillment(created.sale.id, 'ready');
    expect(await data('products', 'p')).toMatchObject({ stock: 10, committedStock: 2, reservedPhysicalStock: 2 });
    await sales.advanceFulfillment(created.sale.id, 'delivered');
    expect(await data('products', 'p')).toMatchObject({ stock: 8, committedStock: 0, reservedPhysicalStock: 0 });
  });

  it('does not automatically consume tracked-order reservations when producing', async () => {
    const created=await sales.create({...draft(),fulfillmentStatus:'in-production',
      lines:[{kind:'product',sourceId:'p',quantity:13}]});
    expect(await data('products','p')).toMatchObject({committedStock:13,
      explicitCommittedStock:13,explicitAllocatedStock:0,reservedPhysicalStock:0});
    await production.create('p',4,day);
    expect(await data('products','p')).toMatchObject({stock:14,
      committedStock:13,reservedPhysicalStock:0});
    await sales.allocateOrderLine(created.sale.id,created.sale.items[0]!.id,4);
    expect(await data('products','p')).toMatchObject({reservedPhysicalStock:4,explicitAllocatedStock:4});
    await sales.cancel(created.sale.id);
    expect(await data('products','p')).toMatchObject({stock:14,committedStock:0,
      explicitCommittedStock:0,explicitAllocatedStock:0,reservedPhysicalStock:0});
  });

  it('keeps legacy automatic reservation without assigning units to a tracked order', async () => {
    await env.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(),'products','p'),
        {stock:0,committedStock:2,reservedPhysicalStock:0},{merge:true});
    });
    const tracked=await sales.create({...draft(),fulfillmentStatus:'in-production',
      lines:[{kind:'product',sourceId:'p',quantity:3}]});
    await production.create('p',4,day);
    expect(await data('products','p')).toMatchObject({stock:4,committedStock:5,
      explicitCommittedStock:3,reservedPhysicalStock:2,explicitAllocatedStock:0});
    await sales.allocateOrderLine(tracked.sale.id,tracked.sale.items[0]!.id,2);
    expect(await data('products','p')).toMatchObject({reservedPhysicalStock:4,explicitAllocatedStock:2});
    await sales.cancel(tracked.sale.id);
    expect(await data('products','p')).toMatchObject({stock:4,committedStock:2,
      explicitCommittedStock:0,reservedPhysicalStock:2,explicitAllocatedStock:0});
  });

  it('reserves ready stock and only decrements inventory at physical delivery', async () => {
    const result = await sales.create({ ...draft(), fulfillmentStatus: 'ready', lines: [{ kind: 'product', sourceId: 'p', quantity: 2 }] });
    expect(await data('products', 'p')).toMatchObject({ stock: 10, committedStock: 2, reservedPhysicalStock: 2 });
    await sales.advanceFulfillment(result.sale.id, 'delivered');
    expect(await data('products', 'p')).toMatchObject({ stock: 8, committedStock: 0, reservedPhysicalStock: 0 });
    await expect(sales.advanceFulfillment(result.sale.id, 'delivered')).rejects.toThrow();
    expect(await count('stockMovements')).toBe(1);
    await sales.cancel(result.sale.id);
    expect(await data('products', 'p')).toMatchObject({ stock: 10, committedStock: 0, reservedPhysicalStock: 0 });
  });

  it('keeps pending purchased materials out of inventory and recognizes freight once on receipt', async () => {
    const result = await finance.createPurchaseBatch({
      businessDate: day, fundingSource: 'maria', receiptStatus: 'pending',
      items: [{ inputId: 'i', unitId: 'u', quantity: 2, amountCents: 500 }],
      charges: [
        { kind: 'shipping', amountCents: 100, capitalized: true },
        { kind: 'interest', amountCents: 60, capitalized: false },
      ],
    });
    expect(result.expense).toMatchObject({ amountCents: 660, bankDebitCents: 0, receiptStatus: 'pending', stockApplied: false });
    expect(result.stockChanges).toHaveLength(0);
    expect(await data('inputs', 'i')).toMatchObject({ stock: 20, averageUnitCostCents: 100 });
    expect(await count('stockMovements')).toBe(0);
    const received = await finance.receivePurchase(result.expense.id);
    expect(received.expense).toMatchObject({ receiptStatus: 'received', stockApplied: true });
    expect(await data('inputs', 'i')).toMatchObject({ stock: 22, costBasisValueCents: 2600 });
    expect(await count('stockMovements')).toBe(1);
    await expect(finance.receivePurchase(result.expense.id)).rejects.toThrow();
    expect(await count('expenses')).toBe(1);
  });

  it('creates a sale with individual products, additions, multiple payments and tip; cancellation restores stocks once', async () => {
    const created = await sales.create({ ...draft(), lines: [
      { kind: 'product', sourceId: 'p', quantity: 3 },
      { kind: 'addition', sourceId: 'a', quantity: 2 },
    ], payments: [{ methodId: 'cash', amountReceivedCents: 1000 }, { methodId: 'pix', amountReceivedCents: 2500 }] });
    const id = created.sale.id;
    expect(created.sale).toMatchObject({ cogsCents: 1700, itemsSold: 3, missingCostItems: 0, analyticsVersion: 1 });
    expect(created.stockChanges).toHaveLength(2);
    expect(await data('products', 'p')).toMatchObject({ stock: 7 });
    expect(await data('inputs', 'i')).toMatchObject({ stock: 18 });
    expect(await data('sales', id)).toMatchObject({ totalCents: 3400, receivedCents: 3400, tipCents: 100, balanceCents: 0, paymentStatus: 'paid' });
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

  it('registers multiple products atomically and preserves itemized production costs', async () => {
    const result = await production.createBatch([
      { productId: 'p', quantity: 2 },
      { productId: 'p-est', quantity: 1 },
    ], day, 'Lançamento do dia');
    expect(result.production.items).toHaveLength(2);
    expect(result.production).toMatchObject({ quantity: 3, totalCostCents: 3000, costPending: false });
    expect(await data('products', 'p')).toMatchObject({ stock: 12 });
    expect(await data('products', 'p-est')).toMatchObject({ stock: 1 });
    expect(await data('inputs', 'i')).toMatchObject({ stock: 10 });
    expect(await data('inputs', 'i-est')).toMatchObject({ stock: 0 });
    expect(await count('productions')).toBe(1);
    expect(await count('stockMovements')).toBe(4);
  });

  it('does not partially register multi-product production when a controlled material is insufficient', async () => {
    await expect(production.createBatch([
      { productId: 'p', quantity: 5 },
      { productId: 'p-est', quantity: 2 },
    ], day)).rejects.toThrow('Estoque insuficiente');
    expect(await count('productions')).toBe(0);
    expect(await count('stockMovements')).toBe(0);
    expect(await data('products', 'p')).toMatchObject({ stock: 10 });
    expect(await data('inputs', 'i')).toMatchObject({ stock: 20 });
  });

  it('books one itemized purchase and updates the cost basis of each input once', async () => {
    const result = await finance.createPurchaseBatch({
      businessDate: day,
      items: [
        { inputId: 'i', unitId: 'u', quantity: 5, amountCents: 500 },
        { inputId: 'i-est', unitId: 'u', quantity: 4, amountCents: 400 },
        { inputId: 'i-un', unitId: 'u', quantity: 3, amountCents: 300 },
      ],
    });
    expect(result.expense).toMatchObject({ kind: 'input-purchase', amountCents: 1200 });
    expect(result.expense.items).toHaveLength(3);
    expect(await count('expenses')).toBe(1);
    expect(await data('inputs', 'i')).toMatchObject({ stock: 25, averageUnitCostCents: 100 });
    expect(await data('inputs', 'i-est')).toMatchObject({ stock: 5, averageUnitCostCents: 120 });
    expect(await data('inputs', 'i-un')).toMatchObject({ stock: 0, averageUnitCostCents: 100 });
    expect(await count('stockMovements')).toBe(2);
  });

  it('rejects invalid itemized purchase before any Firestore write', async () => {
    await expect(finance.createPurchaseBatch({
      businessDate: day,
      items: [{ inputId: 'i', unitId: 'u', quantity: 0, amountCents: 100 }],
    })).rejects.toBeDefined();
    expect(await count('expenses')).toBe(0);
    expect(await data('inputs', 'i')).toMatchObject({ stock: 20 });
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
  it('reconciles absolute stock in an atomic transaction and records only the effective delta', async () => {
    const first = await inventory.reconcile('input', 'i', 'set', 100, 'Conferência', day);
    expect(first.stockChange.stock).toBe(100);
    expect(first.movement.quantityDelta).toBe(80);
    expect(await data('inputs', 'i')).toMatchObject({ stock: 100 });
    expect(await data('stockAdjustments', first.adjustment.id)).toMatchObject({ quantityDelta: 80, reason: 'Conferência' });
    const second = await inventory.reconcile('input', 'i', 'set', 12.5, 'Nova conferência', day);
    expect(second.stockChange.stock).toBe(12.5);
    expect(second.movement.quantityDelta).toBe(-87.5);
    expect(await data('inputs', 'i')).toMatchObject({ stock: 12.5 });
  });

  it('reconciles relative changes and clamps an excessive decrease to zero without negative stock', async () => {
    const plus = await inventory.reconcile('input', 'i', 'delta', 4.5, 'Entrada', day);
    expect(plus.stockChange.stock).toBe(24.5);
    const minus = await inventory.reconcile('input', 'i', 'delta', -100, 'Saída', day);
    expect(minus.stockChange.stock).toBe(0);
    expect(minus.movement.quantityDelta).toBe(-24.5);
    expect(await data('inputs', 'i')).toMatchObject({ stock: 0 });
    expect(await count('stockMovements')).toBe(2);
  });

  it('rejects no-op, invalid negative absolute amount and missing reason without creating history', async () => {
    await expect(inventory.reconcile('input', 'i', 'set', 20, 'Sem mudança', day)).rejects.toThrow('saldo atual');
    await expect(inventory.reconcile('input', 'i', 'set', -10, 'Inválido', day)).rejects.toThrow('negativo');
    await expect(inventory.reconcile('input', 'i', 'set', 100, ' ', day)).rejects.toThrow('motivo');
    expect(await count('stockAdjustments')).toBe(0);
    expect(await count('stockMovements')).toBe(0);
    expect(await data('inputs', 'i')).toMatchObject({ stock: 20 });
  });

  it('does not allow reconciliation for items without stock tracking', async () => {
    await expect(inventory.reconcile('input', 'i-un', 'set', 10, 'Conferência', day)).rejects.toThrow('não controla saldo');
    expect(await data('inputs', 'i-un')).toMatchObject({ stock: 0 });
  });

  it('does not accept fractional stock for finished products', async () => {
    await expect(inventory.reconcile('product', 'p', 'set', 1.5, 'Conferência', day)).rejects.toThrow('quantidade inteira');
    expect(await data('products', 'p')).toMatchObject({ stock: 10 });
  });

  it('bases relative reconciliation on the latest committed stock, not on the UI cache', async () => {
    await inventory.reconcile('input', 'i', 'set', 5, 'Conferência', day);
    await finance.createExpense(purchase());
    const result = await inventory.reconcile('input', 'i', 'delta', -7, 'Ajuste após compra', day);
    expect(result.movement.quantityDelta).toBe(-7);
    expect(result.stockChange.stock).toBe(3);
    expect(await data('inputs', 'i')).toMatchObject({ stock: 3 });
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

    expect(await data('system', 'read-optimization')).toMatchObject({ version: 2, updatedBy: 'operator' });
    expect(await data('products', 'p')).toMatchObject({ stockStatus: 'ok' });
    expect(await data('inputs', 'i')).toMatchObject({ stockStatus: 'ok' });
    for (let index = 0; index < 10; index += 1) {
      expect(await data('products', `legacy-${index}`)).toMatchObject({ stockStatus: 'ok' });
    }
  });

  const correctionDraft = (quantity: number, expectedVersion = 0) => ({
    expectedVersion, businessDate: day, notes: '', reason: 'Teste de correção',
    cancel: false, lines: [{ productId: 'p', quantity }],
  });

  it('corrects quantity atomically using historical costs and records an immutable revision', async () => {
    const id = (await production.create('p', 2, day)).production.id;
    const preview = await productionCorrection.preview(id, correctionDraft(3));
    expect(preview.impacts.map(x => ({ type: x.itemType, delta: x.quantityDelta })))
      .toEqual([{ type: 'product', delta: 1 }, { type: 'input', delta: -5 }]);
    const result = await productionCorrection.apply(id, correctionDraft(3));
    expect(result.production).toMatchObject({ quantity: 3, correctionVersion: 1, totalCostCents: 1500 });
    expect(await data('products', 'p')).toMatchObject({ stock: 13 });
    expect(await data('inputs', 'i')).toMatchObject({ stock: 5 });
    expect(await count('productionCorrections')).toBe(1);
    await expect(productionCorrection.apply(id, correctionDraft(3))).rejects.toThrow('modificada');
    expect(await count('productionCorrections')).toBe(1);
  });

  it('returns only the materials actually debited from estimated inputs', async () => {
    const id = (await production.create('p-est', 2, day)).production.id;
    const reduce = { expectedVersion: 0, businessDate: day, notes: '', reason: 'Menos unidades',
      cancel: false, lines: [{ productId: 'p-est', quantity: 1 }] };
    const preview = await productionCorrection.preview(id, reduce);
    expect(preview.impacts.filter(x => x.itemType === 'input')).toHaveLength(0);
    await productionCorrection.apply(id, reduce);
    expect(await data('inputs', 'i-est')).toMatchObject({ stock: 0 });
    const cancel = { ...reduce, expectedVersion: 1, cancel: true, reason: 'Produção duplicada' };
    await productionCorrection.apply(id, cancel);
    expect(await data('inputs', 'i-est')).toMatchObject({ stock: 1 });
    expect(await data('products', 'p-est')).toMatchObject({ stock: 0 });
    expect(await data('productions', id)).toMatchObject({ status: 'cancelled', correctionVersion: 2 });
    await expect(productionCorrection.apply(id, cancel)).rejects.toThrow('cancelada');
    expect(await count('productionCorrections')).toBe(2);
  });

  it('rejects corrections that would subtract stock already sold or physically reserved', async () => {
    const id = (await production.create('p', 2, day)).production.id;
    await sales.create({ ...draft(), fulfillmentStatus: 'ready',
      lines: [{ kind: 'product', sourceId: 'p', quantity: 11 }] });
    await expect(productionCorrection.apply(id, {
      ...correctionDraft(2), cancel: true, reason: 'Cancelar',
    })).rejects.toThrow('vendidas ou reservadas');
    expect(await data('products', 'p')).toMatchObject({ stock: 12, reservedPhysicalStock: 11 });
    expect(await data('productions', id)).toMatchObject({ quantity: 2 });
    expect(await count('productionCorrections')).toBe(0);
  });


  it('replaces the wrong soap without duplicating stock or its ingredient consumption', async () => {
    const id = (await production.create('p', 1, day)).production.id;
    const updated = { expectedVersion: 0, businessDate: day, notes: '', reason: 'Sabonete errado',
      cancel: false, lines: [{ productId: 'p-est', quantity: 1 }] };
    const preview = await productionCorrection.preview(id, updated);
    expect(preview.impacts.filter(x => x.itemType === 'product').map(x => x.quantityDelta)).toEqual([-1, 1]);
    const result = await productionCorrection.apply(id, updated);
    expect(result.production.items?.[0].productId).toBe('p-est');
    expect(await data('products', 'p')).toMatchObject({ stock: 10 });
    expect(await data('products', 'p-est')).toMatchObject({ stock: 1 });
    expect(await data('inputs', 'i')).toMatchObject({ stock: 20 });
    expect(await data('inputs', 'i-est')).toMatchObject({ stock: 0 });
    expect(await count('productionCorrections')).toBe(1);
  });

  it('can change the date without changing physical inventory balances', async () => {
    const id = (await production.create('p', 1, day)).production.id;
    const draft = { ...correctionDraft(1), businessDate: '2026-10-06', notes: 'Lote corrigido' };
    const preview = await productionCorrection.preview(id, draft);
    expect(preview.impacts).toHaveLength(0);
    await productionCorrection.apply(id, draft);
    expect(await data('productions', id)).toMatchObject({ businessDate: '2026-10-06', notes: 'Lote corrigido' });
    expect(await data('products', 'p')).toMatchObject({ stock: 11 });
    expect(await data('inputs', 'i')).toMatchObject({ stock: 15 });
  });



  it('E2E transaction: replaces a sold soap, preserving stock and an immutable correction log',async()=>{
    await env.withSecurityRulesDisabled(async ctx=>{await setDoc(doc(ctx.firestore(),'products','p2'),
      {code:'P2',displayName:'SOAP TWO',active:true,collectionId:'c',fragranceId:'f',
      formatId:'fmt',salePriceCents:900,additionalCostCents:0,averageUnitCostCents:175,
      stock:4,minimumStock:0,recipe:[],...audit()});});
    const created=(await sales.create({...draft(),lines:[{kind:'product',sourceId:'p',quantity:2}]})).sale;
    await expect(advancedCorrections.correct(created.id,{
      expectedSignature:saleCorrectionSignature(created),
      lines:[{id:'new-p2',kind:'product',sourceId:'p2',quantity:1,unitPriceCents:900}],
      discountCents:0,reason:'Trocar sabonete do pedido',
    })).rejects.toThrow('estoque físico');
    const changed=await advancedCorrections.correct(created.id,{
      expectedSignature:saleCorrectionSignature(created),
      lines:[{id:'new-p2',kind:'product',sourceId:'p2',quantity:1,unitPriceCents:900}],
      discountCents:0,reason:'Trocar sabonete do pedido',stockReconciliationConfirmed:true,
    });
    expect(changed.sale).toMatchObject({totalCents:900,balanceCents:900,productIds:['p2']});
    expect(changed.sale.items).toMatchObject([{id:'new-p2',sourceId:'p2',totalCostCents:175}]);
    expect(await data('products','p')).toMatchObject({stock:10});
    expect(await data('products','p2')).toMatchObject({stock:3});
    expect(await count('saleCorrections')).toBe(1);
    expect(await count('stockMovements')).toBe(3);
    await expect(advancedCorrections.correct(created.id,{
      expectedSignature:saleCorrectionSignature(created),
      lines:[{id:'new-p2',kind:'product',sourceId:'p2',quantity:1,unitPriceCents:900}],
      discountCents:0,reason:'Substituição repetida',stockReconciliationConfirmed:true,
    })).rejects.toThrow('mudou');
  });

  it('E2E transaction: removes an itemized addition and restores only its material',async()=>{
    const created=(await sales.create({...draft(),lines:[
      {kind:'product',sourceId:'p',quantity:1},
      {kind:'addition',sourceId:'a',quantity:2},
    ]})).sale;
    expect(await data('inputs','i')).toMatchObject({stock:18});
    const soap=created.items.find(item=>item.kind==='product')!;
    const updated=await advancedCorrections.correct(created.id,{
      expectedSignature:saleCorrectionSignature(created),
      lines:[{id:soap.id,kind:'product',sourceId:'p',quantity:1,unitPriceCents:soap.unitPriceCents}],
      discountCents:0,reason:'Retirar embalagem duplicada',stockReconciliationConfirmed:true,
    });
    expect(updated.sale.items).toHaveLength(1);
    expect(await data('inputs','i')).toMatchObject({stock:20});
    expect(await data('products','p')).toMatchObject({stock:9});
    expect(await count('saleCorrections')).toBe(1);
  });

  it('E2E transaction: adjusts future order commitments and protects allocated units',async()=>{
    const created=(await sales.create({...draft(),fulfillmentStatus:'in-production',
      lines:[{kind:'product',sourceId:'p',quantity:2}]})).sale;
    const line=created.items[0]!;
    const changed=await advancedCorrections.correct(created.id,{
      expectedSignature:saleCorrectionSignature(created),
      lines:[{id:line.id,kind:'product',sourceId:'p',quantity:3,unitPriceCents:line.unitPriceCents}],
      discountCents:0,reason:'Cliente pediu mais uma unidade',
    });
    expect(await data('products','p')).toMatchObject({stock:10,committedStock:3,explicitCommittedStock:3});
    expect(changed.sale.orderAllocations?.[0]).toMatchObject({lineId:line.id,quantity:0});
    await sales.allocateOrderLine(created.id,line.id,2);
    const latest=await sales.findById(created.id);
    await expect(advancedCorrections.correct(created.id,{
      expectedSignature:saleCorrectionSignature(latest!),
      lines:[{id:line.id,kind:'product',sourceId:'p',quantity:1,unitPriceCents:line.unitPriceCents}],
      discountCents:0,reason:'Reduzir encomenda',
    })).rejects.toThrow('reservada');
    expect(await data('products','p')).toMatchObject({committedStock:3});
  });

  it('E2E transaction: insufficient stock aborts all changes',async()=>{
    await env.withSecurityRulesDisabled(async ctx=>{await setDoc(doc(ctx.firestore(),'products','p2'),
      {code:'P2',displayName:'SOAP TWO',active:true,collectionId:'c',fragranceId:'f',
      formatId:'fmt',salePriceCents:900,additionalCostCents:0,averageUnitCostCents:175,
      stock:1,minimumStock:0,recipe:[],...audit()});});
    const created=(await sales.create(draft())).sale;
    await expect(advancedCorrections.correct(created.id,{
      expectedSignature:saleCorrectionSignature(created),
      lines:[{id:created.items[0]!.id,kind:'product',sourceId:'p',quantity:1,unitPriceCents:1000},
        {id:'new',kind:'product',sourceId:'p2',quantity:3,unitPriceCents:900}],
      discountCents:0,reason:'Adicionar produto indisponível',stockReconciliationConfirmed:true,
    })).rejects.toThrow('Estoque livre');
    expect(await data('products','p2')).toMatchObject({stock:1});
    expect(await data('sales',created.id)).toMatchObject({totalCents:1000});
    expect(await count('saleCorrections')).toBe(0);
  });

});
