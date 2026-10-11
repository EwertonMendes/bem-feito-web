import { inject, Injectable } from '@angular/core';
import { collection, getDocs, limit, query, where } from 'firebase/firestore';
import { Expense } from '../../domain/models/finance.model';
import { Payment, Sale } from '../../domain/models/sales.model';
import { FIRESTORE } from '../firebase/firebase.providers';

/** Searches the complete collection by its stable, human-readable document code.
 * Exact-code lookup deliberately avoids local pagination and composite indexes.
 */
@Injectable({ providedIn: 'root' })
export class FinanceCodeSearchRepository {
  private readonly firestore = inject(FIRESTORE);

  private async byCode<T extends { id: string }>(collectionName: string, code: string): Promise<T[]> {
    const normalized = code.trim().toUpperCase();
    if (!/^[A-Z][0-9]{3,8}$/.test(normalized)) {
      throw new Error('Informe um código completo, por exemplo M000012, V00024 ou P000025.');
    }
    const snapshot = await getDocs(query(
      collection(this.firestore, collectionName),
      where('code', '==', normalized),
      limit(5),
    ));
    return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as T);
  }

  expenses(code: string): Promise<Expense[]> { return this.byCode<Expense>('expenses', code); }
  payments(code: string): Promise<Payment[]> { return this.byCode<Payment>('payments', code); }
  async receivables(code: string): Promise<Sale[]> {
    const sales = await this.byCode<Sale>('sales', code);
    return sales.filter((sale) => sale.status === 'active' &&
      (sale.paymentStatus === 'pending' || sale.paymentStatus === 'partial'));
  }
}
