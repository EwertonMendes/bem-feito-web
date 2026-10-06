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
import { inputStockStatus } from '../../domain/logic/stock-status';
import { InputItem } from '../../domain/models/catalog.model';
import { Expense, ExpenseDraft } from '../../domain/models/finance.model';
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
    return {
      items,
      hasMore,
      nextCursor: hasMore && last ? { businessDate: last.businessDate, id: last.id } : null,
    };
  }

  async totalExpensesCents(): Promise<number> {
    const snapshot = await getAggregateFromServer(collection(this.firestore, 'expenses'), {
      total: sum('amountCents'),
    });
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
      }

      const sequence = Number(counterSnapshot.data()?.['value'] ?? 0) + 1;
      const expenseRef = doc(collection(this.firestore, 'expenses'));
      const code = entityCode('M', sequence, 6);
      transaction.set(counterRef, { value: sequence, updatedAt: serverTimestamp() }, { merge: true });

      let stockChange: ExpenseCreateResult['stockChange'];
      if (input && inputRef && draft.quantity) {
        const quantity = draft.quantity;
        const positiveStock = Math.max(0, input.stock);
        const stock = input.stock + quantity;
        const averageUnitCostCents = Math.round(
          (positiveStock * input.averageUnitCostCents + draft.amountCents) / (positiveStock + quantity),
        );
        transaction.update(inputRef, {
          stock,
          stockStatus: inputStockStatus(stock, input.minimumStock, input.minimumStockConfigured !== false),
          averageUnitCostCents,
          updatedAt: serverTimestamp(),
          updatedBy: userId,
        });

        stockChange = {
          itemType: 'input',
          itemId: input.id,
          stock,
          averageUnitCostCents,
        };

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

      const expense: Expense = {
        id: expenseRef.id,
        ...draft,
        code,
      };
      transaction.set(expenseRef, {
        ...draft,
        code,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdBy: userId,
        updatedBy: userId,
      } satisfies Omit<Expense, 'id'>);

      this.revisions.touchTransaction(
        transaction,
        'expenses',
        ...(stockChange ? ['inventory'] as const : []),
      );

      return { expense, stockChange };
    });
  }
}
