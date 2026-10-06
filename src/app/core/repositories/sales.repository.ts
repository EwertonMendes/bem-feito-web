import { inject, Injectable } from '@angular/core';
import {
  DocumentSnapshot, collection, doc, getDocs, limit, orderBy, query, runTransaction, serverTimestamp,
} from 'firebase/firestore';
import { Addition, InputItem, Kit, Product } from '../../domain/models/catalog.model';
import { StockMovement } from '../../domain/models/inventory.model';
import { Payment, Sale, SaleDraft } from '../../domain/models/sales.model';
import { resolveSaleDraft } from '../../domain/logic/sale-resolution';
import { AuthService } from '../auth/auth.service';
import { FIRESTORE } from '../firebase/firebase.providers';
import { todayBusinessDate } from '../utils/date';
import { entityCode } from '../utils/ids';
import { allocatePayments, paymentStatus } from '../utils/sale-calculations';

@Injectable({ providedIn: 'root' })
export class SalesRepository {
  private readonly firestore = inject(FIRESTORE);
  private readonly auth = inject(AuthService);

  async recent(max = 100): Promise<Sale[]> {
    const snapshot = await getDocs(query(collection(this.firestore, 'sales'), orderBy('businessDate', 'desc'), limit(max)));
    return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as Sale);
  }

  async payments(max = 200): Promise<Payment[]> {
    const snapshot = await getDocs(query(collection(this.firestore, 'payments'), orderBy('businessDate', 'desc'), limit(max)));
    return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as Payment);
  }

  async create(draft: SaleDraft): Promise<string> {
    const userId = this.auth.user()?.uid;
    if (!userId) throw new Error('Sessão inválida.');
    if (!draft.lines.length) throw new Error('Adicione pelo menos um item à venda.');
    if (!draft.businessDate) throw new Error('Informe a data da venda.');

    return runTransaction(this.firestore, async (transaction) => {
      const saleCounterRef = doc(this.firestore, 'counters', 'sale');
      const paymentCounterRef = doc(this.firestore, 'counters', 'payment');
      const saleCounterSnapshot = await transaction.get(saleCounterRef);
      const paymentCounterSnapshot = await transaction.get(paymentCounterRef);

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

      const additions = new Map<string, Addition>();
      const additionInputIds = new Set<string>();
      for (const [id, snapshot] of additionSnapshots) {
        if (!snapshot.exists()) throw new Error('Um adicional da venda não existe mais.');
        const addition = { id, ...snapshot.data() } as Addition;
        if (!addition.active) throw new Error(`${addition.name} está inativo.`);
        additions.set(id, addition);
        addition.components.forEach((component) => additionInputIds.add(component.inputId));
      }

      const inputSnapshots = new Map<string, DocumentSnapshot>();
      for (const id of additionInputIds) inputSnapshots.set(id, await transaction.get(doc(this.firestore, 'inputs', id)));

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

      const inputs = new Map<string, InputItem>();
      for (const [id, snapshot] of inputSnapshots) {
        if (!snapshot.exists()) throw new Error('Um insumo de adicional não existe mais.');
        const input = { id, ...snapshot.data() } as InputItem;
        if (!input.active) throw new Error(`${input.name} está inativo.`);
        inputs.set(id, input);
      }

      const { lines, stockEffects, subtotalCents, discountCents, totalCents } = resolveSaleDraft(draft, {
        products,
        kits,
        additions,
        inputs,
      });

      const allocations = allocatePayments(totalCents, draft.payments);
      const receivedCents = allocations.reduce((sum, item) => sum + item.appliedCents, 0);
      const tipCents = allocations.reduce((sum, item) => sum + item.tipCents, 0);
      const balanceCents = Math.max(0, totalCents - receivedCents);

      if (balanceCents > 0 && !draft.customerName?.trim()) throw new Error('Informe o cliente quando houver saldo a receber.');

      const saleSequence = Number(saleCounterSnapshot.data()?.['value'] ?? 0) + 1;
      let paymentSequence = Number(paymentCounterSnapshot.data()?.['value'] ?? 0);
      const saleRef = doc(collection(this.firestore, 'sales'));
      const paymentIds: string[] = [];

      transaction.set(saleCounterRef, { value: saleSequence, updatedAt: serverTimestamp() }, { merge: true });
      if (allocations.length) transaction.set(paymentCounterRef, { value: paymentSequence + allocations.length, updatedAt: serverTimestamp() }, { merge: true });

      for (const allocation of allocations) {
        paymentSequence += 1;
        const paymentRef = doc(collection(this.firestore, 'payments'));
        paymentIds.push(paymentRef.id);
        transaction.set(paymentRef, {
          code: entityCode('P', paymentSequence, 6),
          saleId: saleRef.id,
          businessDate: draft.businessDate,
          methodId: allocation.methodId,
          amountReceivedCents: allocation.amountReceivedCents,
          appliedCents: allocation.appliedCents,
          tipCents: allocation.tipCents,
          status: 'active',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          createdBy: userId,
          updatedBy: userId,
        } satisfies Omit<Payment, 'id'>);
      }

      for (const effect of stockEffects) {
        const targetRef = doc(this.firestore, effect.itemType === 'product' ? 'products' : 'inputs', effect.itemId);
        const entity = effect.itemType === 'product' ? products.get(effect.itemId) : inputs.get(effect.itemId);
        if (!entity) continue;

        transaction.update(targetRef, {
          stock: entity.stock + effect.quantityDelta,
          updatedAt: serverTimestamp(),
          updatedBy: userId,
        });

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

      transaction.set(saleRef, {
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
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdBy: userId,
        updatedBy: userId,
      } satisfies Omit<Sale, 'id'>);

      return saleRef.id;
    });
  }

  async addPayment(saleId: string, businessDate: string, methodId: string, amountReceivedCents: number): Promise<void> {
    const userId = this.auth.user()?.uid;
    if (!userId) throw new Error('Sessão inválida.');
    if (!businessDate) throw new Error('Informe a data do recebimento.');
    if (!methodId) throw new Error('Selecione a forma de pagamento.');
    if (!Number.isFinite(amountReceivedCents) || amountReceivedCents <= 0) throw new Error('Informe um valor válido.');

    await runTransaction(this.firestore, async (transaction) => {
      const saleRef = doc(this.firestore, 'sales', saleId);
      const counterRef = doc(this.firestore, 'counters', 'payment');
      const saleSnapshot = await transaction.get(saleRef);
      const counterSnapshot = await transaction.get(counterRef);
      if (!saleSnapshot.exists()) throw new Error('Venda não encontrada.');

      const sale = { id: saleSnapshot.id, ...saleSnapshot.data() } as Sale;
      if (sale.status !== 'active') throw new Error('Não é possível receber uma venda cancelada.');
      if (sale.balanceCents <= 0) throw new Error('Esta venda já está totalmente paga.');

      const received = Math.round(amountReceivedCents);
      const applied = Math.min(sale.balanceCents, received);
      const tip = Math.max(0, received - applied);
      const newReceived = sale.receivedCents + applied;
      const newTip = sale.tipCents + tip;
      const newBalance = Math.max(0, sale.totalCents - newReceived);
      const sequence = Number(counterSnapshot.data()?.['value'] ?? 0) + 1;
      const paymentRef = doc(collection(this.firestore, 'payments'));

      transaction.set(counterRef, { value: sequence, updatedAt: serverTimestamp() }, { merge: true });
      transaction.set(paymentRef, {
        code: entityCode('P', sequence, 6),
        saleId: sale.id,
        businessDate,
        methodId,
        amountReceivedCents: received,
        appliedCents: applied,
        tipCents: tip,
        status: 'active',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdBy: userId,
        updatedBy: userId,
      } satisfies Omit<Payment, 'id'>);

      transaction.update(saleRef, {
        receivedCents: newReceived,
        tipCents: newTip,
        balanceCents: newBalance,
        paymentStatus: paymentStatus(sale.totalCents, newReceived),
        paymentIds: [...sale.paymentIds, paymentRef.id],
        updatedAt: serverTimestamp(),
        updatedBy: userId,
      });
    });
  }

  async reversePayment(paymentId: string): Promise<void> {
    const userId = this.auth.user()?.uid;
    if (!userId) throw new Error('Sessão inválida.');

    await runTransaction(this.firestore, async (transaction) => {
      const paymentRef = doc(this.firestore, 'payments', paymentId);
      const paymentSnapshot = await transaction.get(paymentRef);
      if (!paymentSnapshot.exists()) throw new Error('Recebimento não encontrado.');

      const payment = { id: paymentSnapshot.id, ...paymentSnapshot.data() } as Payment;
      if (payment.status !== 'active') throw new Error('Este recebimento já foi estornado.');

      const saleRef = doc(this.firestore, 'sales', payment.saleId);
      const saleSnapshot = await transaction.get(saleRef);
      if (!saleSnapshot.exists()) throw new Error('Venda vinculada não encontrada.');

      const sale = { id: saleSnapshot.id, ...saleSnapshot.data() } as Sale;
      if (sale.status !== 'active') throw new Error('A venda está cancelada.');

      const newReceived = Math.max(0, sale.receivedCents - payment.appliedCents);
      const newTip = Math.max(0, sale.tipCents - payment.tipCents);
      const newBalance = Math.max(0, sale.totalCents - newReceived);

      transaction.update(paymentRef, {
        status: 'reversed',
        updatedAt: serverTimestamp(),
        updatedBy: userId,
      });

      transaction.update(saleRef, {
        receivedCents: newReceived,
        tipCents: newTip,
        balanceCents: newBalance,
        paymentStatus: paymentStatus(sale.totalCents, newReceived),
        updatedAt: serverTimestamp(),
        updatedBy: userId,
      });
    });
  }

  async cancel(saleId: string): Promise<void> {
    const userId = this.auth.user()?.uid;
    if (!userId) throw new Error('Sessão inválida.');

    await runTransaction(this.firestore, async (transaction) => {
      const saleRef = doc(this.firestore, 'sales', saleId);
      const saleSnapshot = await transaction.get(saleRef);
      if (!saleSnapshot.exists()) throw new Error('Venda não encontrada.');

      const sale = { id: saleSnapshot.id, ...saleSnapshot.data() } as Sale;
      if (sale.status === 'cancelled') return;

      const stockSnapshots = new Map<string, DocumentSnapshot>();
      for (const effect of sale.stockEffects) {
        const ref = doc(this.firestore, effect.itemType === 'product' ? 'products' : 'inputs', effect.itemId);
        stockSnapshots.set(`${effect.itemType}:${effect.itemId}`, await transaction.get(ref));
      }

      const paymentSnapshots = [];
      for (const paymentId of sale.paymentIds) paymentSnapshots.push(await transaction.get(doc(this.firestore, 'payments', paymentId)));

      for (const effect of sale.stockEffects) {
        const snapshot = stockSnapshots.get(`${effect.itemType}:${effect.itemId}`);
        if (!snapshot?.exists()) throw new Error('Não foi possível reverter o estoque da venda.');

        const currentStock = Number(snapshot.data()['stock'] ?? 0);
        transaction.update(snapshot.ref, {
          stock: currentStock - effect.quantityDelta,
          updatedAt: serverTimestamp(),
          updatedBy: userId,
        });

        const movementRef = doc(collection(this.firestore, 'stockMovements'));
        transaction.set(movementRef, {
          itemType: effect.itemType,
          itemId: effect.itemId,
          quantityDelta: -effect.quantityDelta,
          unitCostCents: effect.unitCostCents,
          totalCostCents: Math.round(Math.abs(effect.quantityDelta) * effect.unitCostCents),
          sourceType: 'sale-cancellation',
          sourceId: sale.id,
          businessDate: todayBusinessDate(),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          createdBy: userId,
          updatedBy: userId,
        } satisfies Omit<StockMovement, 'id'>);
      }

      for (const paymentSnapshot of paymentSnapshots) {
        if (!paymentSnapshot.exists() || paymentSnapshot.data()['status'] !== 'active') continue;
        transaction.update(paymentSnapshot.ref, {
          status: 'reversed',
          updatedAt: serverTimestamp(),
          updatedBy: userId,
        });
      }

      transaction.update(saleRef, {
        status: 'cancelled',
        paymentStatus: 'cancelled',
        balanceCents: 0,
        cancelledAt: serverTimestamp(),
        cancelledBy: userId,
        updatedAt: serverTimestamp(),
        updatedBy: userId,
      });
    });
  }
}
