import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';
import { ExpenseKind } from '../../domain/models/finance.model';
export type ModalRequest =
  | { kind: 'sale'; productId?: string; kitId?: string }
  | { kind: 'production'; productId?: string; date?: string }
  | { kind: 'expense'; expenseKind: ExpenseKind }
  | { kind: 'receipt'; saleId: string };
@Injectable({ providedIn: 'root' })
export class ModalActions {
 private readonly requests = new Subject<ModalRequest>();
 readonly opened = this.requests.asObservable();
 openSale(productId?: string, kitId?: string): void { this.requests.next({kind:'sale',productId,kitId}); }
 openProduction(productId?: string, date?: string): void { this.requests.next({kind:'production',productId,date}); }
 openExpense(expenseKind: ExpenseKind = 'operating-expense'): void { this.requests.next({kind:'expense',expenseKind}); }
 openReceipt(saleId: string): void { this.requests.next({kind:'receipt',saleId}); }
}
