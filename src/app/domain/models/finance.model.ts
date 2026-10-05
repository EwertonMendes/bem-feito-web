import { AuditFields } from './common.model';

export type ExpenseKind = 'input-purchase' | 'operating-expense' | 'equipment' | 'other';

export interface Expense extends AuditFields {
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
