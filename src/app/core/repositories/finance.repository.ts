import { inject, Injectable } from '@angular/core';
import { collection, doc, getDocs, limit, orderBy, query, runTransaction, serverTimestamp } from 'firebase/firestore';
import { InputItem } from '../../domain/models/catalog.model';
import { Expense, ExpenseDraft } from '../../domain/models/finance.model';
import { StockMovement } from '../../domain/models/inventory.model';
import { AuthService } from '../auth/auth.service';
import { FIRESTORE } from '../firebase/firebase.providers';
import { entityCode } from '../utils/ids';

@Injectable({ providedIn: 'root' })
export class FinanceRepository {
  private readonly firestore = inject(FIRESTORE);
  private readonly auth = inject(AuthService);

  async recentExpenses(max = 150): Promise<Expense[]> {
    const snapshot = await getDocs(query(collection(this.firestore, 'expenses'), orderBy('businessDate', 'desc'), limit(max)));
    return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as Expense);
  }

  async createExpense(draft: ExpenseDraft): Promise<string> {
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
      let inputRef = draft.inputId ? doc(this.firestore, 'inputs', draft.inputId) : null;

      if (draft.kind === 'input-purchase' && inputRef) {
        const inputSnapshot = await transaction.get(inputRef);
        if (!inputSnapshot.exists()) throw new Error('Insumo não encontrado.');
        input = { id: inputSnapshot.id, ...inputSnapshot.data() } as InputItem;
        if (!input.active) throw new Error('O insumo está inativo.');
      }

      const sequence = Number(counterSnapshot.data()?.['value'] ?? 0) + 1;
      const expenseRef = doc(collection(this.firestore, 'expenses'));
      transaction.set(counterRef, { value: sequence, updatedAt: serverTimestamp() }, { merge: true });

      if (input && inputRef && draft.quantity) {
        const quantity = draft.quantity;
        const positiveStock = Math.max(0, input.stock);
        const newAverage = Math.round((positiveStock * input.averageUnitCostCents + draft.amountCents) / (positiveStock + quantity));
        transaction.update(inputRef, {
          stock: input.stock + quantity,
          averageUnitCostCents: newAverage,
          updatedAt: serverTimestamp(),
          updatedBy: userId,
        });

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

      transaction.set(expenseRef, {
        ...draft,
        code: entityCode('M', sequence, 6),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdBy: userId,
        updatedBy: userId,
      } satisfies Omit<Expense, 'id'>);

      return expenseRef.id;
    });
  }
}
