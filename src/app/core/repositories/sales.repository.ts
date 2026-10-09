import { inject, Injectable } from '@angular/core';
import {
  DocumentSnapshot,
  collection,
  doc,
  documentId,
  getAggregateFromServer,
  getDocs,
  getDoc,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  startAfter,
  count,
  sum,
  where,
} from 'firebase/firestore';
import { summarizeSaleItems } from '../../domain/logic/sale-analytics';
import { productCostComponents, standardCostForProduct } from '../../domain/logic/costing';
import { productStockStatus, stockStatusForInput } from '../../domain/logic/stock-status';
import { Addition, CollectionDefinition, FormatDefinition, FragranceDefinition, InputItem, Kit, Product } from '../../domain/models/catalog.model';
import { StockMovement } from '../../domain/models/inventory.model';
import { Payment, Sale, SaleDraft } from '../../domain/models/sales.model';
import { resolveSaleDraft } from '../../domain/logic/sale-resolution';
import { AuthService } from '../auth/auth.service';
import { DataRevisionService } from '../firebase/data-revision.service';
import { FIRESTORE } from '../firebase/firebase.providers';
import { todayBusinessDate } from '../utils/date';
import { entityCode } from '../utils/ids';
import { allocatePayments, paymentStatus } from '../utils/sale-calculations';
import {
  SaleCancellationResult,
  SaleCreateResult,
  SalePaymentResult,
  SalePaymentReversalResult,
  StockChange,
} from './mutation-results';
import { BusinessDateCursor, PageResult } from './pagination';

@Injectable({ providedIn: 'root' })
export class SalesRepository {
  private readonly firestore = inject(FIRESTORE);
  private readonly auth = inject(AuthService);
  private readonly revisions = inject(DataRevisionService);

  async findById(id: string): Promise<Sale | null> {
    const snapshot = await getDoc(doc(this.firestore, 'sales', id));
    return snapshot.exists() ? ({ id: snapshot.id, ...snapshot.data() } as Sale) : null;
  }

  async page(pageSize = 40, cursor?: BusinessDateCursor | null): Promise<PageResult<Sale>> {
    const constraints = [
      orderBy('businessDate', 'desc'),
      orderBy(documentId(), 'desc'),
      ...(cursor ? [startAfter(cursor.businessDate, cursor.id)] : []),
      limit(pageSize + 1),
    ];
    const snapshot = await getDocs(query(collection(this.firestore, 'sales'), ...constraints));
    const hasMore = snapshot.docs.length > pageSize;
    const docs = snapshot.docs.slice(0, pageSize);
    const items = docs.map((item) => ({ id: item.id, ...item.data() }) as Sale);
    const last = items.at(-1);
    return {
      items,
      hasMore,
      nextCursor: hasMore && last ? { businessDate: last.businessDate, id: last.id } : null,
    };
  }

  async receivablePage(
    pageSize = 40,
    cursor?: BusinessDateCursor | null,
  ): Promise<PageResult<Sale>> {
    const constraints = [
      where('status', '==', 'active'),
      where('paymentStatus', 'in', ['pending', 'partial']),
      orderBy('businessDate', 'desc'),
      orderBy(documentId(), 'desc'),
      ...(cursor ? [startAfter(cursor.businessDate, cursor.id)] : []),
      limit(pageSize + 1),
    ];
    const snapshot = await getDocs(query(collection(this.firestore, 'sales'), ...constraints));
    const hasMore = snapshot.docs.length > pageSize;
    const docs = snapshot.docs.slice(0, pageSize);
    const items = docs.map((item) => ({ id: item.id, ...item.data() }) as Sale);
    const last = items.at(-1);
    return {
      items,
      hasMore,
      nextCursor: hasMore && last ? { businessDate: last.businessDate, id: last.id } : null,
    };
  }

  async paymentPage(pageSize = 40, cursor?: BusinessDateCursor | null): Promise<PageResult<Payment>> {
    const constraints = [
      orderBy('businessDate', 'desc'),
      orderBy(documentId(), 'desc'),
      ...(cursor ? [startAfter(cursor.businessDate, cursor.id)] : []),
      limit(pageSize + 1),
    ];
    const snapshot = await getDocs(query(collection(this.firestore, 'payments'), ...constraints));
    const hasMore = snapshot.docs.length > pageSize;
    const docs = snapshot.docs.slice(0, pageSize);
    const items = docs.map((item) => ({ id: item.id, ...item.data() }) as Payment);
    const last = items.at(-1);
    return {
      items,
      hasMore,
      nextCursor: hasMore && last ? { businessDate: last.businessDate, id: last.id } : null,
    };
  }

  async paymentCount(): Promise<number> {
    const snapshot = await getAggregateFromServer(collection(this.firestore, 'payments'), {
      total: count(),
    });
    return Number(snapshot.data().total ?? 0);
  }

  async receivableTotalCents(): Promise<number> {
    // Cancellation atomically sets balanceCents to zero, so this produces the same total
    // without requiring a status + balanceCents composite index.
    const snapshot = await getAggregateFromServer(collection(this.firestore, 'sales'), {
      total: sum('balanceCents'),
    });
    return Number(snapshot.data().total ?? 0);
  }

  async create(draft: SaleDraft): Promise<SaleCreateResult> {
    const userId = this.auth.user()?.uid;
    if (!userId) throw new Error('Sessão inválida.');
    if (!draft.lines.length) throw new Error('Adicione pelo menos um item à venda.');
    if (!draft.businessDate) throw new Error('Informe a data da venda.');

    return runTransaction(this.firestore, async (transaction) => {
      const saleCounterRef = doc(this.firestore, 'counters', 'sale');
      const saleCounterSnapshot = await transaction.get(saleCounterRef);

      const productLineIds = draft.lines.filter((line) => line.kind === 'product').map((line) => line.sourceId);
      const kitIds = draft.lines.filter((line) => line.kind === 'kit').map((line) => line.sourceId);
      const additionIds = draft.lines.filter((line) => line.kind === 'addition').map((line) => line.sourceId);
      const kitProductIds = draft.lines.filter((line) => line.kind === 'kit').flatMap((line) => line.componentProductIds);
      const productIds = [...new Set([...productLineIds, ...kitProductIds])];

      const productSnapshots = new Map<string, DocumentSnapshot>();
      for (const id of productIds) productSnapshots.set(id, await transaction.get(doc(this.firestore, 'products', id)));

      const kitSnapshots = new Map<string, DocumentSnapshot>();
      for (const id of [...new Set(kitIds)]) kitSnapshots.set(id, await transaction.get(doc(this.firestore, 'kits', id)));

      const additionSnapshots = new Map<string, DocumentSnapshot>();
      for (const id of [...new Set(additionIds)]) additionSnapshots.set(id, await transaction.get(doc(this.firestore, 'additions', id)));

      const products = new Map<string, Product>();
      for (const [id, snapshot] of productSnapshots) {
        if (!snapshot.exists()) throw new Error('Um produto da venda não existe mais.');
        const product = { id, ...snapshot.data() } as Product;
        if (!product.active) throw new Error(`${product.displayName} está inativo.`);
        products.set(id, product);
      }

      const kits = new Map<string, Kit>();
      for (const [id, snapshot] of kitSnapshots) {
        if (!snapshot.exists()) throw new Error('Um kit da venda não existe mais.');
        const kit = { id, ...snapshot.data() } as Kit;
        if (!kit.active) throw new Error(`${kit.name} está inativo.`);
        kits.set(id, kit);
      }

      const additions = new Map<string, Addition>();
      const additionInputIds = new Set<string>();
      for (const [id, snapshot] of additionSnapshots) {
        if (!snapshot.exists()) throw new Error('Um adicional da venda não existe mais.');
        const addition = { id, ...snapshot.data() } as Addition;
        if (!addition.active) throw new Error(`${addition.name} está inativo.`);
        additions.set(id, addition);
        addition.components.forEach((component) => additionInputIds.add(component.inputId));
      }

      const collections = new Map<string, CollectionDefinition>();
      for (const id of new Set([...products.values()].map((item) => item.collectionId))) {
        const snapshot = await transaction.get(doc(this.firestore, 'collections', id));
        if (snapshot.exists()) collections.set(id, { id, ...snapshot.data() } as CollectionDefinition);
      }

      const fragrances = new Map<string, FragranceDefinition>();
      for (const id of new Set([...products.values()].map((item) => item.fragranceId))) {
        const snapshot = await transaction.get(doc(this.firestore, 'fragrances', id));
        if (snapshot.exists()) fragrances.set(id, { id, ...snapshot.data() } as FragranceDefinition);
      }

      const formats = new Map<string, FormatDefinition>();
      for (const id of new Set([...products.values()].map((item) => item.formatId))) {
        const snapshot = await transaction.get(doc(this.firestore, 'formats', id));
        if (snapshot.exists()) formats.set(id, { id, ...snapshot.data() } as FormatDefinition);
      }

      const requiredInputIds = new Set<string>(additionInputIds);
      for (const [id, product] of products) {
        const components = productCostComponents(product, {
          collection: collections.get(product.collectionId),
          fragrance: fragrances.get(product.fragranceId),
          format: formats.get(product.formatId),
        });
        components.forEach((component) => requiredInputIds.add(component.inputId));
      }

      const inputSnapshots = new Map<string, DocumentSnapshot>();
      for (const id of requiredInputIds) inputSnapshots.set(id, await transaction.get(doc(this.firestore, 'inputs', id)));

      const inputs = new Map<string, InputItem>();
      for (const [id, snapshot] of inputSnapshots) {
        if (!snapshot.exists()) throw new Error('Um insumo usado na venda não existe mais.');
        const input = { id, ...snapshot.data() } as InputItem;
        if (additionInputIds.has(id) && !input.active) throw new Error(`${input.name} está inativo.`);
        inputs.set(id, input);
      }

      const productUnitCosts = new Map<string, number>();
      for (const [id, product] of products) {
        const cost = standardCostForProduct(product, {
          collection: collections.get(product.collectionId),
          fragrance: fragrances.get(product.fragranceId),
          format: formats.get(product.formatId),
        }, inputs);
        productUnitCosts.set(id, cost.unitCostCents);
      }

      const { lines, stockEffects, subtotalCents, discountCents, totalCents } = resolveSaleDraft(draft, {
        products,
        kits,
        additions,
        inputs,
        productUnitCosts,
      });
      const analytics = summarizeSaleItems(lines);

      const allocations = allocatePayments(totalCents, draft.payments);
      const paymentCounterRef = doc(this.firestore, 'counters', 'payment');
      const paymentCounterSnapshot = allocations.length ? await transaction.get(paymentCounterRef) : null;
      const receivedCents = allocations.reduce((sum, item) => sum + item.appliedCents, 0);
      const tipCents = allocations.reduce((sum, item) => sum + item.tipCents, 0);
      const balanceCents = Math.max(0, totalCents - receivedCents);

      if (balanceCents > 0 && !draft.customerName?.trim()) throw new Error('Informe o cliente quando houver saldo a receber.');

      const saleSequence = Number(saleCounterSnapshot.data()?.['value'] ?? 0) + 1;
      let paymentSequence = Number(paymentCounterSnapshot?.data()?.['value'] ?? 0);
      const saleRef = doc(collection(this.firestore, 'sales'));
      const paymentIds: string[] = [];
      const payments: Payment[] = [];

      transaction.set(saleCounterRef, { value: saleSequence, updatedAt: serverTimestamp() }, { merge: true });
      if (allocations.length) {
        transaction.set(paymentCounterRef, { value: paymentSequence + allocations.length, updatedAt: serverTimestamp() }, { merge: true });
      }

      for (const allocation of allocations) {
        paymentSequence += 1;
        const paymentRef = doc(collection(this.firestore, 'payments'));
        paymentIds.push(paymentRef.id);
        const payment: Payment = {
          id: paymentRef.id,
          code: entityCode('P', paymentSequence, 6),
          saleId: saleRef.id,
          businessDate: draft.businessDate,
          methodId: allocation.methodId,
          amountReceivedCents: allocation.amountReceivedCents,
          appliedCents: allocation.appliedCents,
          tipCents: allocation.tipCents,
          status: 'active',
        };
        payments.push(payment);
        transaction.set(paymentRef, {
          code: payment.code,
          saleId: payment.saleId,
          businessDate: payment.businessDate,
          methodId: payment.methodId,
          amountReceivedCents: payment.amountReceivedCents,
          appliedCents: payment.appliedCents,
          tipCents: payment.tipCents,
          status: payment.status,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          createdBy: userId,
          updatedBy: userId,
        } satisfies Omit<Payment, 'id'>);
      }

      const stockChanges: StockChange[] = [];
      for (const effect of stockEffects) {
        const targetRef = doc(this.firestore, effect.itemType === 'product' ? 'products' : 'inputs', effect.itemId);
        const entity = effect.itemType === 'product' ? products.get(effect.itemId) : inputs.get(effect.itemId);
        if (!entity) continue;
        const isReservation = draft.fulfillmentStatus === 'ready' || draft.fulfillmentStatus === 'in-production';
        const required = -effect.quantityDelta;
        const committedStock = Number(entity.committedStock ?? 0);
        const available = Number(entity.stock ?? 0) - committedStock;
        if (!isReservation && required > available) throw new Error('Estoque disponível insuficiente para concluir a venda.');
        if (draft.fulfillmentStatus === 'ready' && required > available) throw new Error('Para reservar itens que ainda serão produzidos, selecione Encomenda.');
        const stock = isReservation ? entity.stock : entity.stock + effect.quantityDelta;
        const stockStatus = effect.itemType === 'product'
          ? productStockStatus(stock, (entity as Product).minimumStock)
          : stockStatusForInput({ ...(entity as InputItem), stock });

        transaction.update(targetRef, { stock, stockStatus,
          ...(isReservation ? { committedStock: committedStock + required } : {}),
          updatedAt: serverTimestamp(), updatedBy: userId });
        stockChanges.push({ itemType: effect.itemType, itemId: effect.itemId, stock });
        if (isReservation) continue;

        const movementRef = doc(collection(this.firestore, 'stockMovements'));
        transaction.set(movementRef, {
          itemType: effect.itemType,
          itemId: effect.itemId,
          quantityDelta: effect.quantityDelta,
          unitCostCents: effect.unitCostCents,
          totalCostCents: Math.round(Math.abs(effect.quantityDelta) * effect.unitCostCents),
          sourceType: 'sale',
          sourceId: saleRef.id,
          businessDate: draft.businessDate,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          createdBy: userId,
          updatedBy: userId,
        } satisfies Omit<StockMovement, 'id'>);
      }

      const sale: Sale = {
        id: saleRef.id,
        code: entityCode('V', saleSequence, 5),
        businessDate: draft.businessDate,
        customerName: draft.customerName?.trim() || undefined,
        dueDate: draft.dueDate || undefined,
        discountCents,
        subtotalCents,
        totalCents,
        receivedCents,
        tipCents,
        balanceCents,
        paymentStatus: paymentStatus(totalCents, receivedCents),
        status: 'active',
        notes: draft.notes?.trim() || undefined,
        items: lines,
        paymentIds,
        stockEffects,
        fulfillmentStatus: draft.fulfillmentStatus ?? 'delivered',
        stockApplied: draft.fulfillmentStatus !== 'ready' && draft.fulfillmentStatus !== 'in-production',
        ...analytics,
      };

      transaction.set(saleRef, {
        code: sale.code,
        businessDate: sale.businessDate,
        customerName: sale.customerName,
        dueDate: sale.dueDate,
        discountCents,
        subtotalCents,
        totalCents,
        receivedCents,
        tipCents,
        balanceCents,
        paymentStatus: sale.paymentStatus,
        status: sale.status,
        fulfillmentStatus: sale.fulfillmentStatus,
        stockApplied: sale.stockApplied,
        notes: sale.notes,
        items: lines,
        paymentIds,
        stockEffects,
        ...analytics,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdBy: userId,
        updatedBy: userId,
      } satisfies Omit<Sale, 'id'>);

      this.revisions.touchTransaction(transaction, 'sales', 'inventory', ...(allocations.length ? ['payments'] as const : []));
      return { sale, payments, stockChanges };
    });
  }

  async addPayment(
    saleId: string,
    businessDate: string,
    methodId: string,
    amountReceivedCents: number,
  ): Promise<SalePaymentResult> {
    const userId = this.auth.user()?.uid;
    if (!userId) throw new Error('Sessão inválida.');
    if (!businessDate) throw new Error('Informe a data do recebimento.');
    if (!methodId) throw new Error('Selecione a forma de pagamento.');
    if (!Number.isFinite(amountReceivedCents) || amountReceivedCents <= 0) {
      throw new Error('Informe um valor válido.');
    }

    return runTransaction(this.firestore, async (transaction) => {
      const saleRef = doc(this.firestore, 'sales', saleId);
      const counterRef = doc(this.firestore, 'counters', 'payment');
      const saleSnapshot = await transaction.get(saleRef);
      const counterSnapshot = await transaction.get(counterRef);
      if (!saleSnapshot.exists()) throw new Error('Venda não encontrada.');

      const current = { id: saleSnapshot.id, ...saleSnapshot.data() } as Sale;
      if (current.status !== 'active') throw new Error('Não é possível receber uma venda cancelada.');
      if (current.balanceCents <= 0) throw new Error('Esta venda já está totalmente paga.');

      const received = Math.round(amountReceivedCents);
      const applied = Math.min(current.balanceCents, received);
      const tip = Math.max(0, received - applied);
      const newReceived = current.receivedCents + applied;
      const newTip = current.tipCents + tip;
      const newBalance = Math.max(0, current.totalCents - newReceived);
      const sequence = Number(counterSnapshot.data()?.['value'] ?? 0) + 1;
      const paymentRef = doc(collection(this.firestore, 'payments'));

      const payment: Payment = {
        id: paymentRef.id,
        code: entityCode('P', sequence, 6),
        saleId: current.id,
        businessDate,
        methodId,
        amountReceivedCents: received,
        appliedCents: applied,
        tipCents: tip,
        status: 'active',
      };
      const sale: Sale = {
        ...current,
        receivedCents: newReceived,
        tipCents: newTip,
        balanceCents: newBalance,
        paymentStatus: paymentStatus(current.totalCents, newReceived),
        paymentIds: [...current.paymentIds, paymentRef.id],
      };

      transaction.set(counterRef, { value: sequence, updatedAt: serverTimestamp() }, { merge: true });
      transaction.set(paymentRef, {
        code: payment.code,
        saleId: payment.saleId,
        businessDate: payment.businessDate,
        methodId: payment.methodId,
        amountReceivedCents: payment.amountReceivedCents,
        appliedCents: payment.appliedCents,
        tipCents: payment.tipCents,
        status: payment.status,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdBy: userId,
        updatedBy: userId,
      } satisfies Omit<Payment, 'id'>);

      transaction.update(saleRef, {
        receivedCents: sale.receivedCents,
        tipCents: sale.tipCents,
        balanceCents: sale.balanceCents,
        paymentStatus: sale.paymentStatus,
        paymentIds: sale.paymentIds,
        updatedAt: serverTimestamp(),
        updatedBy: userId,
      });

      this.revisions.touchTransaction(transaction, 'sales', 'payments');
      return { sale, payment, previousBalanceCents: current.balanceCents };
    });
  }

  async reversePayment(paymentId: string): Promise<SalePaymentReversalResult> {
    const userId = this.auth.user()?.uid;
    if (!userId) throw new Error('Sessão inválida.');

    return runTransaction(this.firestore, async (transaction) => {
      const paymentRef = doc(this.firestore, 'payments', paymentId);
      const paymentSnapshot = await transaction.get(paymentRef);
      if (!paymentSnapshot.exists()) throw new Error('Recebimento não encontrado.');

      const currentPayment = { id: paymentSnapshot.id, ...paymentSnapshot.data() } as Payment;
      if (currentPayment.status !== 'active') throw new Error('Este recebimento já foi estornado.');

      const saleRef = doc(this.firestore, 'sales', currentPayment.saleId);
      const saleSnapshot = await transaction.get(saleRef);
      if (!saleSnapshot.exists()) throw new Error('Venda vinculada não encontrada.');

      const currentSale = { id: saleSnapshot.id, ...saleSnapshot.data() } as Sale;
      if (currentSale.status !== 'active') throw new Error('A venda está cancelada.');

      const newReceived = Math.max(0, currentSale.receivedCents - currentPayment.appliedCents);
      const newTip = Math.max(0, currentSale.tipCents - currentPayment.tipCents);
      const newBalance = Math.max(0, currentSale.totalCents - newReceived);

      const payment: Payment = { ...currentPayment, status: 'reversed' };
      const sale: Sale = {
        ...currentSale,
        receivedCents: newReceived,
        tipCents: newTip,
        balanceCents: newBalance,
        paymentStatus: paymentStatus(currentSale.totalCents, newReceived),
      };

      transaction.update(paymentRef, {
        status: 'reversed',
        updatedAt: serverTimestamp(),
        updatedBy: userId,
      });
      transaction.update(saleRef, {
        receivedCents: sale.receivedCents,
        tipCents: sale.tipCents,
        balanceCents: sale.balanceCents,
        paymentStatus: sale.paymentStatus,
        updatedAt: serverTimestamp(),
        updatedBy: userId,
      });

      this.revisions.touchTransaction(transaction, 'sales', 'payments');
      return { sale, payment, previousBalanceCents: currentSale.balanceCents };
    });
  }

  async cancel(saleId: string): Promise<SaleCancellationResult> {
    const userId = this.auth.user()?.uid;
    if (!userId) throw new Error('Sessão inválida.');

    return runTransaction(this.firestore, async (transaction) => {
      const saleRef = doc(this.firestore, 'sales', saleId);
      const saleSnapshot = await transaction.get(saleRef);
      if (!saleSnapshot.exists()) throw new Error('Venda não encontrada.');

      const currentSale = { id: saleSnapshot.id, ...saleSnapshot.data() } as Sale;
      if (currentSale.status === 'cancelled') {
        return { sale: currentSale, previousBalanceCents: currentSale.balanceCents, reversedPaymentIds: [], stockChanges: [] };
      }

      const stockSnapshots = new Map<string, DocumentSnapshot>();
      for (const effect of currentSale.stockEffects) {
        const ref = doc(this.firestore, effect.itemType === 'product' ? 'products' : 'inputs', effect.itemId);
        stockSnapshots.set(`${effect.itemType}:${effect.itemId}`, await transaction.get(ref));
      }

      const paymentSnapshots = [];
      for (const paymentId of currentSale.paymentIds) {
        paymentSnapshots.push(await transaction.get(doc(this.firestore, 'payments', paymentId)));
      }

      const stockChanges: StockChange[] = [];
      for (const effect of currentSale.stockEffects) {
        const snapshot = stockSnapshots.get(`${effect.itemType}:${effect.itemId}`);
        if (!snapshot?.exists()) throw new Error('Não foi possível reverter o estoque da venda.');

        const entity = { id: snapshot.id, ...snapshot.data() } as Product | InputItem;
        const stock = currentSale.stockApplied === false
          ? Number(snapshot.data()['stock'] ?? 0)
          : Number(snapshot.data()['stock'] ?? 0) - effect.quantityDelta;
        const committedStock = currentSale.stockApplied === false
          ? Math.max(0, Number(snapshot.data()['committedStock'] ?? 0) + effect.quantityDelta)
          : Number(snapshot.data()['committedStock'] ?? 0);
        const stockStatus = effect.itemType === 'product'
          ? productStockStatus(stock, (entity as Product).minimumStock)
          : stockStatusForInput({ ...(entity as InputItem), stock });

        transaction.update(snapshot.ref, {
          stock,
          stockStatus,
          committedStock,
          updatedAt: serverTimestamp(),
          updatedBy: userId,
        });
        stockChanges.push({ itemType: effect.itemType, itemId: effect.itemId, stock });

        if (currentSale.stockApplied === false) continue;
        const movementRef = doc(collection(this.firestore, 'stockMovements'));
        transaction.set(movementRef, {
          itemType: effect.itemType,
          itemId: effect.itemId,
          quantityDelta: -effect.quantityDelta,
          unitCostCents: effect.unitCostCents,
          totalCostCents: Math.round(Math.abs(effect.quantityDelta) * effect.unitCostCents),
          sourceType: 'sale-cancellation',
          sourceId: currentSale.id,
          businessDate: todayBusinessDate(),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          createdBy: userId,
          updatedBy: userId,
        } satisfies Omit<StockMovement, 'id'>);
      }

      const reversedPaymentIds: string[] = [];
      for (const paymentSnapshot of paymentSnapshots) {
        if (!paymentSnapshot.exists() || paymentSnapshot.data()['status'] !== 'active') continue;
        reversedPaymentIds.push(paymentSnapshot.id);
        transaction.update(paymentSnapshot.ref, {
          status: 'reversed',
          updatedAt: serverTimestamp(),
          updatedBy: userId,
        });
      }

      const sale: Sale = {
        ...currentSale,
        status: 'cancelled',
        paymentStatus: 'cancelled',
        balanceCents: 0,
        cancelledBy: userId,
      };
      transaction.update(saleRef, {
        status: 'cancelled',
        paymentStatus: 'cancelled',
        balanceCents: 0,
        cancelledAt: serverTimestamp(),
        cancelledBy: userId,
        updatedAt: serverTimestamp(),
        updatedBy: userId,
      });

      this.revisions.touchTransaction(
        transaction,
        'sales',
        'inventory',
        ...(reversedPaymentIds.length ? ['payments'] as const : []),
      );
      return { sale, previousBalanceCents: currentSale.balanceCents, reversedPaymentIds, stockChanges };
    });
  }
}
