import { inject, Injectable } from '@angular/core';
import {
  collection,
  doc,
  documentId,
  getAggregateFromServer,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  startAfter,
  sum,
} from 'firebase/firestore';
import { trackingModeForInput } from '../../domain/logic/costing';
import { stockStatusForInput } from '../../domain/logic/stock-status';
import { InputItem } from '../../domain/models/catalog.model';
import { Expense, ExpenseDraft, PurchaseBatchDraft } from '../../domain/models/finance.model';
import { StockMovement } from '../../domain/models/inventory.model';
import { AuthService } from '../auth/auth.service';
import { DataRevisionService } from '../firebase/data-revision.service';
import { FIRESTORE } from '../firebase/firebase.providers';
import { entityCode } from '../utils/ids';
import { ExpenseCreateResult } from './mutation-results';
import { BusinessDateCursor, PageResult } from './pagination';

@Injectable({ providedIn: 'root' })
export class FinanceRepository {
  private readonly firestore = inject(FIRESTORE);
  private readonly auth = inject(AuthService);
  private readonly revisions = inject(DataRevisionService);

  async expensePage(pageSize = 40, cursor?: BusinessDateCursor | null): Promise<PageResult<Expense>> {
    const constraints = [
      orderBy('businessDate', 'desc'),
      orderBy(documentId(), 'desc'),
      ...(cursor ? [startAfter(cursor.businessDate, cursor.id)] : []),
      limit(pageSize + 1),
    ];
    const snapshot = await getDocs(query(collection(this.firestore, 'expenses'), ...constraints));
    const hasMore = snapshot.docs.length > pageSize;
    const docs = snapshot.docs.slice(0, pageSize);
    const items = docs.map((item) => ({ id: item.id, ...item.data() }) as Expense);
    const last = items.at(-1);
    return { items, hasMore, nextCursor: hasMore && last ? { businessDate: last.businessDate, id: last.id } : null };
  }

  async totalExpensesCents(): Promise<number> {
    const snapshot = await getAggregateFromServer(collection(this.firestore, 'expenses'), { total: sum('amountCents') });
    return Number(snapshot.data().total ?? 0);
  }

  async createExpense(draft: ExpenseDraft): Promise<ExpenseCreateResult> {
    const userId = this.auth.user()?.uid;
    if (!userId) throw new Error('Sessão inválida.');
    if (!draft.businessDate) throw new Error('Informe a data.');
    if (!Number.isFinite(draft.amountCents) || draft.amountCents <= 0) throw new Error('Informe um valor válido.');
    if (draft.kind === 'input-purchase' && (!draft.inputId || !draft.quantity || draft.quantity <= 0)) {
      throw new Error('Selecione o insumo e informe a quantidade comprada.');
    }

    return runTransaction(this.firestore, async (transaction) => {
      const counterRef = doc(this.firestore, 'counters', 'expense');
      const counterSnapshot = await transaction.get(counterRef);
      let input: InputItem | null = null;
      const inputRef = draft.inputId ? doc(this.firestore, 'inputs', draft.inputId) : null;
      if (draft.kind === 'input-purchase' && inputRef) {
        const inputSnapshot = await transaction.get(inputRef);
        if (!inputSnapshot.exists()) throw new Error('Insumo não encontrado.');
        input = { id: inputSnapshot.id, ...inputSnapshot.data() } as InputItem;
        if (!input.active) throw new Error('O insumo está inativo.');
        if (draft.unitId && draft.unitId !== input.unitId) throw new Error('A compra deve usar a unidade base cadastrada para o insumo.');
      }

      const sequence = Number(counterSnapshot.data()?.['value'] ?? 0) + 1;
      const expenseRef = doc(collection(this.firestore, 'expenses'));
      const code = entityCode('M', sequence, 6);
      transaction.set(counterRef, { value: sequence, updatedAt: serverTimestamp() }, { merge: true });

      let stockChange: ExpenseCreateResult['stockChange'];
      if (input && inputRef && draft.quantity) {
        const quantity = draft.quantity;
        const mode = trackingModeForInput(input);
        const previousBasisQuantity = Math.max(0, Number(input.costBasisQuantity ?? input.stock ?? 0));
        const previousBasisValueCents = Math.max(0, Number(input.costBasisValueCents ?? Math.round(previousBasisQuantity * input.averageUnitCostCents)));
        const costBasisQuantity = previousBasisQuantity + quantity;
        const costBasisValueCents = previousBasisValueCents + draft.amountCents;
        const averageUnitCostCents = Math.round(costBasisValueCents / costBasisQuantity);
        const stock = mode === 'untracked' ? input.stock : input.stock + quantity;
        const updatedInput = { ...input, stock, averageUnitCostCents, costBasisQuantity, costBasisValueCents };

        transaction.update(inputRef, {
          ...(mode === 'untracked' ? {} : { stock, stockStatus: stockStatusForInput(updatedInput) }),
          averageUnitCostCents,
          costBasisQuantity,
          costBasisValueCents,
          updatedAt: serverTimestamp(),
          updatedBy: userId,
        });
        stockChange = { itemType: 'input', itemId: input.id, stock, averageUnitCostCents };

        if (mode !== 'untracked') {
          const movementRef = doc(collection(this.firestore, 'stockMovements'));
          transaction.set(movementRef, {
            itemType: 'input',
            itemId: input.id,
            quantityDelta: quantity,
            unitCostCents: Math.round(draft.amountCents / quantity),
            totalCostCents: draft.amountCents,
            sourceType: 'purchase',
            sourceId: expenseRef.id,
            businessDate: draft.businessDate,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            createdBy: userId,
            updatedBy: userId,
          } satisfies Omit<StockMovement, 'id'>);
        }
      }

      const expense: Expense = { id: expenseRef.id, ...draft, code };
      transaction.set(expenseRef, {
        ...draft,
        code,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdBy: userId,
        updatedBy: userId,
      } satisfies Omit<Expense, 'id'>);

      this.revisions.touchTransaction(transaction, 'expenses', ...(draft.kind === 'input-purchase' ? ['inventory'] as const : []));
      return { expense, stockChange };
    });
  }

  /** One receipt and one Firestore transaction for any number of purchased inputs. */
  async createPurchaseBatch(draft: PurchaseBatchDraft): Promise<ExpenseCreateResult> {
    const userId = this.auth.user()?.uid;
    if (!userId) throw new Error('Sessão inválida.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.businessDate)) throw new Error('Data inválida.');
    if (!draft.items.length || draft.items.length > 40) throw new Error('Informe de 1 a 40 insumos por compra.');
    const grouped = new Map<string, { quantity: number; amountCents: number; unitId: string }>();
    for (const item of draft.items) {
      if (!item.inputId || !Number.isFinite(item.quantity) || item.quantity <= 0 ||
          !Number.isSafeInteger(item.amountCents) || item.amountCents <= 0) {
        throw new Error('Revise os itens, quantidades e valores da compra.');
      }
      const current = grouped.get(item.inputId);
      if (current && current.unitId !== item.unitId) throw new Error('Unidades incompatíveis no mesmo insumo.');
      grouped.set(item.inputId, {
        unitId: item.unitId, quantity: (current?.quantity ?? 0) + item.quantity,
        amountCents: (current?.amountCents ?? 0) + item.amountCents,
      });
    }
    const total = [...grouped.values()].reduce((sum, item) => sum + item.amountCents, 0);
    return runTransaction(this.firestore, async transaction => {
      const counterRef = doc(this.firestore, 'counters', 'expense');
      const counter = await transaction.get(counterRef);
      const snapshots = await Promise.all([...grouped.keys()].map(id => transaction.get(doc(this.firestore, 'inputs', id))));
      const inputs = snapshots.map(snapshot => {
        if (!snapshot.exists()) throw new Error('Insumo não encontrado.');
        const input = { id: snapshot.id, ...snapshot.data() } as InputItem;
        if (!input.active) throw new Error('Insumo inativo na compra.');
        if (input.unitId !== grouped.get(input.id)?.unitId) throw new Error('Unidade incompatível com o insumo ' + input.name);
        return { snapshot, input };
      });
      const sequence = Number(counter.data()?.['value'] ?? 0) + 1;
      const expenseRef = doc(collection(this.firestore, 'expenses'));
      const items = [...grouped].map(([inputId, value]) => ({ inputId, ...value }));
      const stockChanges: NonNullable<ExpenseCreateResult['stockChanges']> = [];
      transaction.set(counterRef, { value: sequence, updatedAt: serverTimestamp() }, { merge: true });
      for (const { snapshot, input } of inputs) {
        const item = grouped.get(input.id)!;
        const mode = trackingModeForInput(input);
        const prevQty = Math.max(0, Number(input.costBasisQuantity ?? input.stock ?? 0));
        const prevValue = Math.max(0, Number(input.costBasisValueCents ?? Math.round(prevQty * input.averageUnitCostCents)));
        const costBasisQuantity = prevQty + item.quantity;
        const costBasisValueCents = prevValue + item.amountCents;
        const averageUnitCostCents = Math.round(costBasisValueCents / costBasisQuantity);
        const stock = mode === 'untracked' ? input.stock : input.stock + item.quantity;
        transaction.update(snapshot.ref, {
          ...(mode !== 'untracked' ? { stock, stockStatus: stockStatusForInput({ ...input, stock }) } : {}),
          costBasisQuantity, costBasisValueCents, averageUnitCostCents,
          updatedAt: serverTimestamp(), updatedBy: userId,
        });
        stockChanges.push({ itemType: 'input', itemId: input.id, stock, averageUnitCostCents });
        if (mode !== 'untracked') {
          const movementRef = doc(collection(this.firestore, 'stockMovements'));
          transaction.set(movementRef, {
            itemType: 'input', itemId: input.id, quantityDelta: item.quantity,
            unitCostCents: Math.round(item.amountCents / item.quantity),
            totalCostCents: item.amountCents,
            sourceType: 'purchase', sourceId: expenseRef.id, businessDate: draft.businessDate,
            createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
            createdBy: userId, updatedBy: userId,
          } satisfies Omit<StockMovement, 'id'>);
        }
      }
      const expense: Expense = {
        id: expenseRef.id, code: entityCode('M', sequence, 6),
        businessDate: draft.businessDate, kind: 'input-purchase', amountCents: total,
        items, notes: draft.notes, link: draft.link, paymentMethodId: draft.paymentMethodId,
      };
      const { id: _id, ...data } = expense;
      transaction.set(expenseRef, {
        ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
        createdBy: userId, updatedBy: userId,
      } satisfies Omit<Expense, 'id'>);
      this.revisions.touchTransaction(transaction, 'expenses', 'inventory');
      return { expense, stockChanges };
    });
  }
}
