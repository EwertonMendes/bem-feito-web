import { inject, Injectable } from '@angular/core';
import {
  DocumentSnapshot,
  QueryConstraint,
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
import { Addition, CollectionDefinition, FormatDefinition, FragranceDefinition, InputItem, Product } from '../../domain/models/catalog.model';
import { StockMovement } from '../../domain/models/inventory.model';
import { Payment, Sale, SaleDraft } from '../../domain/models/sales.model';
import { allocatedQuantity, validatedAllocation } from '../../domain/logic/order-progress';
import { resolveSaleDraft } from '../../domain/logic/sale-resolution';
import { AuthService } from '../auth/auth.service';
import { DataRevisionService } from '../firebase/data-revision.service';
import { FIRESTORE } from '../firebase/firebase.providers';
import { todayBusinessDate } from '../utils/date';
import { entityCode } from '../utils/ids';
import { customerSearchPrefixes, normalizeCustomerSearch } from '../utils/customer-search';
import { allocatePayments, paymentStatus } from '../utils/sale-calculations';
import {
  SaleCancellationResult,
  SaleCreateResult,
  SaleFulfillmentResult,
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

  /** All historical pages have an explicit, stable cursor. Never filter only the loaded UI rows. */
  async searchHistoricalPage(raw:string,filters:{
    status?:'all'|'paid'|'open'|'cancelled';from?:string;to?:string;productId?:string
  }={},cursor:BusinessDateCursor|null=null,pageSize=40):Promise<PageResult<Sale>>{
    const term=normalizeCustomerSearch(raw);
    if(term.length>120)throw new Error('Pesquisa muito longa.');
    if(filters.from&&filters.to&&filters.from>filters.to)throw new Error('Intervalo de datas inválido.');
    const saleCollection=collection(this.firestore,'sales');
    const code=/^v[0-9]{1,6}$/i.test(raw.trim())?'V'+raw.trim().slice(1).padStart(5,'0'):null;
    if(code){
      const one=await getDocs(query(saleCollection,where('code','==',code),limit(1)));
      return {items:one.docs.map(d=>({id:d.id,...d.data()} as Sale)).filter(s=>matchesHistoryFilters(s,filters)),
        hasMore:false,nextCursor:null};
    }
    if(term.length===1)throw new Error('Digite ao menos duas letras.');
    const constraints:QueryConstraint[]=[
      ...(term?[where('customerSearchPrefixes','array-contains',term)]:[]),
      ...(filters.from?[where('businessDate','>=',filters.from)]:[]),
      ...(filters.to?[where('businessDate','<=',filters.to)]:[]),
      orderBy('businessDate','desc'),orderBy(documentId(),'desc'),
    ];
    const results:Sale[]=[];
    let next=cursor;
    for(let i=0;i<12;i++){
      const batch=await getDocs(query(saleCollection,...constraints,
        ...(next?[startAfter(next.businessDate,next.id)]:[]),limit(pageSize+1)));
      for(const d of batch.docs.slice(0,pageSize)){
        const row={id:d.id,...d.data()} as Sale;
        next={businessDate:row.businessDate,id:row.id};
        if(matchesHistoryFilters(row,filters))results.push(row);
        if(results.length>=pageSize)break;
      }
      const more=batch.docs.length>pageSize || results.length>=pageSize;
      if(results.length>=pageSize || !more || i===11)
        return {items:results,hasMore:more,nextCursor:more?next:null};
    }
    return {items:results,hasMore:false,nextCursor:null};
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
      const additionIds = draft.lines.filter((line) => line.kind === 'addition').map((line) => line.sourceId);
      const productIds = [...new Set(productLineIds)];

      const productSnapshots = new Map<string, DocumentSnapshot>();
      for (const id of productIds) productSnapshots.set(id, await transaction.get(doc(this.firestore, 'products', id)));
      const additionSnapshots = new Map<string, DocumentSnapshot>();
      for (const id of [...new Set(additionIds)]) additionSnapshots.set(id, await transaction.get(doc(this.firestore, 'additions', id)));

      const products = new Map<string, Product>();
      for (const [id, snapshot] of productSnapshots) {
        if (!snapshot.exists()) throw new Error('Um produto da venda não existe mais.');
        const product = { id, ...snapshot.data() } as Product;
        if (!product.active) throw new Error(`${product.displayName} está inativo.`);
        products.set(id, product);
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
        const reservedPhysicalStock = Number(entity.reservedPhysicalStock ?? Math.min(committedStock, Number(entity.stock ?? 0)));
        const available = Number(entity.stock ?? 0) - reservedPhysicalStock;
        if (!isReservation && required > available) throw new Error('Estoque disponível insuficiente para concluir a venda.');
        if (draft.fulfillmentStatus === 'ready' && required > available) throw new Error('Para reservar itens que ainda serão produzidos, selecione Encomenda.');
        const stock = isReservation ? entity.stock : entity.stock + effect.quantityDelta;
        const stockStatus = effect.itemType === 'product'
          ? productStockStatus(stock, (entity as Product).minimumStock)
          : stockStatusForInput({ ...(entity as InputItem), stock });

        const physicalAllocation = draft.fulfillmentStatus === 'ready' ? required : 0;
        const explicitCounters = isReservation && effect.itemType === 'product' ? {
          explicitCommittedStock: (entity as Product).explicitCommittedStock === undefined
            ? required : (entity as Product).explicitCommittedStock! + required,
          explicitAllocatedStock: ((entity as Product).explicitAllocatedStock ?? 0) + physicalAllocation,
        } : {};
        transaction.update(targetRef, { stock, stockStatus,
          ...(isReservation ? { committedStock: committedStock + required, reservedPhysicalStock: reservedPhysicalStock + physicalAllocation, ...explicitCounters } : {}),
          updatedAt: serverTimestamp(), updatedBy: userId });
        stockChanges.push({ itemType: effect.itemType, itemId: effect.itemId, stock, ...(isReservation ? { committedStock: committedStock + required, reservedPhysicalStock: reservedPhysicalStock + physicalAllocation } : {}) });
        if (isReservation) continue;

        const movementRef = doc(collection(this.firestore, 'stockMovements'));
        transaction.set(movementRef, {
          itemType: effect.itemType,
          itemId: effect.itemId,
          quantityDelta: effect.quantityDelta,
          unitCostCents: effect.unitCostCents,
          totalCostCents: Math.round(Math.abs(effect.quantityDelta) * (effect.unitCostDeciCents ?? effect.unitCostCents * 10) / 10),
          sourceType: 'sale',
          sourceId: saleRef.id,
          businessDate: draft.businessDate,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          createdBy: userId,
          updatedBy: userId,
        } satisfies Omit<StockMovement, 'id'>);
      }

      const orderAllocations = draft.fulfillmentStatus === 'in-production' || draft.fulfillmentStatus === 'ready'
        ? lines.filter(line => line.kind === 'product').map(line => ({
            lineId: line.id, productId: line.sourceId,
            quantity: draft.fulfillmentStatus === 'ready' ? line.quantity : 0,
          })) : undefined;
      const sale: Sale = {
        id: saleRef.id,
        code: entityCode('V', saleSequence, 5),
        businessDate: draft.businessDate,
        customerName: draft.customerName?.trim() || undefined,
        ...(draft.customerName?.trim() ? {customerSearchKey:normalizeCustomerSearch(draft.customerName),customerSearchPrefixes:customerSearchPrefixes(draft.customerName)} : {}),
        productIds:[...new Set(lines.filter(line=>line.kind==='product').map(line=>line.sourceId))],
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
        ...(orderAllocations ? { orderAllocations } : {}),
        fulfillmentStatus: draft.fulfillmentStatus ?? 'delivered',
        stockApplied: draft.fulfillmentStatus !== 'ready' && draft.fulfillmentStatus !== 'in-production',
        ...analytics,
      };

      transaction.set(saleRef, {
        code: sale.code,
        businessDate: sale.businessDate,
        customerName: sale.customerName,
        ...(sale.customerSearchKey ? {customerSearchKey: sale.customerSearchKey,customerSearchPrefixes:sale.customerSearchPrefixes} : {}),
        productIds:sale.productIds,
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
        ...(orderAllocations ? { orderAllocations } : {}),
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


  /** Advance fulfillment without changing financial settlement. */
  /** Allocate newly available physical stock to a specific open order line. */
  async allocateOrderLine(saleId: string, lineId: string, quantity: number): Promise<SaleFulfillmentResult> {
    const userId = this.auth.user()?.uid;
    if (!userId) throw new Error('Sessão inválida.');
    return runTransaction(this.firestore, async tx => {
      const saleRef = doc(this.firestore, 'sales', saleId);
      const snapshot = await tx.get(saleRef);
      if (!snapshot.exists()) throw new Error('Encomenda não encontrada.');
      const sale = {id:snapshot.id,...snapshot.data()} as Sale;
      if (sale.status !== 'active' || sale.stockApplied !== false || sale.fulfillmentStatus !== 'in-production')
        throw new Error('Apenas encomendas em produção podem receber alocações.');
      if (!sale.orderAllocations) throw new Error('Encomenda anterior ao controle individual: concilie antes de reservar.');
      const line = sale.items.find(item => item.id === lineId && item.kind === 'product');
      if (!line) throw new Error('Sabonete não encontrado nesta encomenda.');
      const current = allocatedQuantity(sale.orderAllocations, line);
      const next = validatedAllocation(line, current, quantity);
      const productRef = doc(this.firestore, 'products', line.sourceId);
      const productSnapshot = await tx.get(productRef);
      if (!productSnapshot.exists()) throw new Error('Produto não encontrado no estoque.');
      const product = {id:productSnapshot.id,...productSnapshot.data()} as Product;
      const reserved = product.reservedPhysicalStock ?? Math.min(product.stock, product.committedStock ?? 0);
      if (product.stock - reserved < quantity) throw new Error('Não há sabonetes livres suficientes para esta encomenda.');
      const allocations = sale.orderAllocations.map(a => a.lineId === line.id ? {...a,quantity:next} : a);
      const allocatedExplicit = product.explicitAllocatedStock ?? 0;
      const committedExplicit = product.explicitCommittedStock ?? 0;
      if (allocatedExplicit + quantity > committedExplicit)
        throw new Error('Os compromissos da encomenda estão inconsistentes.');
      tx.update(productRef, {
        reservedPhysicalStock: reserved + quantity, explicitAllocatedStock: allocatedExplicit + quantity,
        updatedAt: serverTimestamp(), updatedBy:userId,
      });
      tx.update(saleRef, { orderAllocations: allocations,
        updatedAt: serverTimestamp(), updatedBy:userId });
      const history = doc(collection(this.firestore, 'orderAllocationHistory'));
      tx.set(history, { saleId, lineId, productId: line.sourceId, businessDate: todayBusinessDate(),
        quantityAdded: quantity, before: current, after: next,
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
        createdBy: userId, updatedBy: userId });
      this.revisions.touchTransaction(tx,'sales','inventory');
      return {sale:{...sale,orderAllocations:allocations},
        stockChanges:[{itemType:'product' as const,itemId:product.id,stock:product.stock,
          committedStock:product.committedStock??0,reservedPhysicalStock:reserved+quantity}]};
    });
  }

  async advanceFulfillment(saleId: string, next: 'ready' | 'delivered'): Promise<SaleFulfillmentResult> {
    const userId = this.auth.user()?.uid;
    if (!userId) throw new Error('Sessão inválida.');
    return runTransaction(this.firestore, async (transaction) => {
      const saleRef = doc(this.firestore, 'sales', saleId);
      const saleSnapshot = await transaction.get(saleRef);
      if (!saleSnapshot.exists()) throw new Error('Venda não encontrada.');
      const current = { id: saleSnapshot.id, ...saleSnapshot.data() } as Sale;
      if (current.status !== 'active') throw new Error('Venda cancelada.');
      if (current.stockApplied !== false) throw new Error('Esta venda já teve o estoque baixado.');
      const previous = current.fulfillmentStatus ?? 'delivered';
      if (next === 'ready' && previous !== 'in-production') throw new Error('A encomenda não está em produção.');
      if (next === 'delivered' && previous !== 'ready') throw new Error('Marque a encomenda como pronta antes da entrega.');
      if (current.orderAllocations && next === 'ready') {
        for (const item of current.items.filter(line => line.kind === 'product')) {
          if (allocatedQuantity(current.orderAllocations, item) !== item.quantity)
            throw new Error('Ainda faltam unidades alocadas a esta encomenda. Confira os itens.');
        }
      }

      const refs = new Map<string, DocumentSnapshot>();
      for (const effect of current.stockEffects) {
        const path = effect.itemType === 'product' ? 'products' : 'inputs';
        refs.set(path + ':' + effect.itemId, await transaction.get(doc(this.firestore, path, effect.itemId)));
      }
      const changes: StockChange[] = [];
      for (const effect of current.stockEffects) {
        const path = effect.itemType === 'product' ? 'products' : 'inputs';
        const snapshot = refs.get(path + ':' + effect.itemId);
        if (!snapshot?.exists()) throw new Error('Item da encomenda não encontrado no estoque.');
        const required = -effect.quantityDelta;
        const committed = Number(snapshot.data()['committedStock'] ?? 0);
        const physical = Number(snapshot.data()['stock'] ?? 0);
        const physicallyReserved = Number(snapshot.data()['reservedPhysicalStock'] ?? Math.min(physical, committed));
        if (required < 0 || committed < required) throw new Error('Reserva inconsistente. É necessária conciliação.');
        if (next === 'ready') {
          // Physical stock was already reserved on this exact order by allocateOrderLine.
          if (current.orderAllocations && effect.itemType === 'product') continue;
          if (physical < committed) throw new Error('Ainda faltam unidades para concluir esta encomenda.');
          // Allocate currently free physical units, but never exceed total active demand.
          if (physicallyReserved < committed) {
            transaction.update(snapshot.ref, {
              reservedPhysicalStock: committed, updatedAt: serverTimestamp(), updatedBy: userId,
            });
            changes.push({ itemType: effect.itemType, itemId: effect.itemId, stock: physical,
              committedStock: committed, reservedPhysicalStock: committed });
          }
          continue;
        }
        if (physical < required || physicallyReserved < required) throw new Error('Estoque físico reservado insuficiente para entregar.');
        const entity = { id: snapshot.id, ...snapshot.data() } as Product | InputItem;
        const stock = physical - required;
        const committedStock = committed - required;
        const reservedPhysicalStock = physicallyReserved - required;
        const stockStatus = effect.itemType === 'product'
          ? productStockStatus(stock, (entity as Product).minimumStock)
          : stockStatusForInput({ ...(entity as InputItem), stock });
        const tracked = current.orderAllocations && effect.itemType === 'product';
        const explicitCounters = tracked ? {
          explicitCommittedStock: (entity as Product).explicitCommittedStock! - required,
          explicitAllocatedStock: (entity as Product).explicitAllocatedStock! - required,
        } : {};
        if (tracked && (explicitCounters.explicitCommittedStock! < 0 || explicitCounters.explicitAllocatedStock! < 0))
          throw new Error('Contadores de encomendas inconsistentes.');
        transaction.update(snapshot.ref, { stock, committedStock, reservedPhysicalStock, stockStatus,
          ...explicitCounters, updatedAt: serverTimestamp(), updatedBy: userId });
        changes.push({ itemType: effect.itemType, itemId: effect.itemId, stock, committedStock, reservedPhysicalStock });
        const movementRef = doc(collection(this.firestore, 'stockMovements'));
        transaction.set(movementRef, {
          itemType: effect.itemType, itemId: effect.itemId, quantityDelta: effect.quantityDelta,
          unitCostCents: effect.unitCostCents, totalCostCents: Math.round(required * (effect.unitCostDeciCents ?? effect.unitCostCents * 10) / 10),
          sourceType: 'sale', sourceId: current.id, businessDate: todayBusinessDate(),
          createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
          createdBy: userId, updatedBy: userId,
        } satisfies Omit<StockMovement, 'id'>);
      }
      const sale: Sale = { ...current, fulfillmentStatus: next, stockApplied: next === 'delivered' };
      transaction.update(saleRef, { fulfillmentStatus: next, stockApplied: next === 'delivered', updatedAt: serverTimestamp(), updatedBy: userId });
      this.revisions.touchTransaction(transaction, 'sales', 'inventory');
      return { sale, stockChanges: changes };
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
        const originallyReserved = Number(snapshot.data()['reservedPhysicalStock'] ?? Math.min(Number(snapshot.data()['committedStock'] ?? 0), Number(snapshot.data()['stock'] ?? 0)));
        const allocatedHere = currentSale.orderAllocations && effect.itemType === 'product'
          ? currentSale.orderAllocations.filter(item => item.productId === effect.itemId)
            .reduce((total, item) => total + item.quantity, 0) : null;
        const allocatedExplicit = effect.itemType === 'product'
          ? (entity as Product).explicitAllocatedStock ?? 0 : 0;
        const committedExplicit = effect.itemType === 'product'
          ? (entity as Product).explicitCommittedStock ?? 0 : 0;
        const reservedPhysicalStock = currentSale.stockApplied === false
          ? allocatedHere !== null ? originallyReserved - allocatedHere
            : effect.itemType === 'product'
              ? allocatedExplicit + Math.min(Math.max(0, originallyReserved - allocatedExplicit),
                  Math.max(0, committedStock - committedExplicit))
              : Math.min(originallyReserved, committedStock)
          : originallyReserved;
        if (reservedPhysicalStock < 0 || reservedPhysicalStock > committedStock)
          throw new Error('Reserva global inconsistente com a encomenda. Faça a conciliação.');
        const stockStatus = effect.itemType === 'product'
          ? productStockStatus(stock, (entity as Product).minimumStock)
          : stockStatusForInput({ ...(entity as InputItem), stock });

        const tracked = currentSale.stockApplied === false && currentSale.orderAllocations && effect.itemType === 'product';
        const trackedCounters = tracked ? {
          explicitCommittedStock: (entity as Product).explicitCommittedStock! + effect.quantityDelta,
          explicitAllocatedStock: (entity as Product).explicitAllocatedStock! - (allocatedHere ?? 0),
        } : {};
        if (tracked && (trackedCounters.explicitCommittedStock! < 0 || trackedCounters.explicitAllocatedStock! < 0))
          throw new Error('Contadores de encomendas inconsistentes.');
        transaction.update(snapshot.ref, {
          stock,
          stockStatus,
          committedStock,
          reservedPhysicalStock,
          ...trackedCounters,
          updatedAt: serverTimestamp(),
          updatedBy: userId,
        });
        stockChanges.push({ itemType: effect.itemType, itemId: effect.itemId, stock, committedStock, reservedPhysicalStock });

        if (currentSale.stockApplied === false) continue;
        const movementRef = doc(collection(this.firestore, 'stockMovements'));
        transaction.set(movementRef, {
          itemType: effect.itemType,
          itemId: effect.itemId,
          quantityDelta: -effect.quantityDelta,
          unitCostCents: effect.unitCostCents,
          totalCostCents: Math.round(Math.abs(effect.quantityDelta) * (effect.unitCostDeciCents ?? effect.unitCostCents * 10) / 10),
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

function matchesHistoryFilters(sale:Sale,filters:{
  status?:'all'|'paid'|'open'|'cancelled';from?:string;to?:string;productId?:string
}):boolean{
  if(filters.from&&sale.businessDate<filters.from)return false;
  if(filters.to&&sale.businessDate>filters.to)return false;
  if(filters.status==='paid'&&sale.paymentStatus!=='paid')return false;
  if(filters.status==='open'&&(sale.status!=='active'||sale.balanceCents<=0))return false;
  if(filters.status==='cancelled'&&sale.status!=='cancelled')return false;
  if(filters.productId&&!((sale.productIds??sale.items.filter(x=>x.kind==='product').map(x=>x.sourceId)).includes(filters.productId)))return false;
  return true;
}
