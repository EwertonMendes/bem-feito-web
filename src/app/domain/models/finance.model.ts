import { AuditFields } from './common.model';

export type ExpenseKind = 'input-purchase' | 'operating-expense' | 'equipment' | 'other';

export interface PurchaseItem {
  inputId: string;
  quantity: number;
  amountCents: number;
  unitId: string;
}
export interface PurchaseBatchDraft {
  businessDate: string;
  paymentMethodId?: string;
  notes?: string;
  link?: string;
  items: PurchaseItem[];
}
export interface Expense extends AuditFields {
  /** Consolidated itemized purchase; legacy one-input purchases remain supported. */
  items?: PurchaseItem[];

  id: string;
  code: string;
  businessDate: string;
  kind: ExpenseKind;
  categoryId?: string;
  inputId?: string;
  quantity?: number;
  unitId?: string;
  amountCents: number;
  paymentMethodId?: string;
  notes?: string;
  link?: string;
}

export interface ExpenseDraft {
  businessDate: string;
  kind: ExpenseKind;
  categoryId?: string;
  inputId?: string;
  quantity?: number;
  unitId?: string;
  amountCents: number;
  paymentMethodId?: string;
  notes?: string;
  link?: string;
}
