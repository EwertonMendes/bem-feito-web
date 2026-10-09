import { AuditFields } from './common.model';

export type ExpenseKind = 'input-purchase' | 'operating-expense' | 'equipment' | 'other';
export type FundingSource = 'business' | 'ewerton' | 'maria';
export type ReceiptStatus = 'pending' | 'received';
/** Charges belong to the same purchase payment; they never create a second cash movement. */
export interface AcquisitionCharge {
  kind: 'shipping' | 'interest' | 'other';
  amountCents: number;
  capitalized: boolean;
  description?: string;
}


export interface PurchaseItem {
  inputId: string;
  quantity: number;
  amountCents: number;
  unitId: string;
  landedCostCents?: number;
}
export interface PurchaseBatchDraft {
  businessDate: string;
  paymentMethodId?: string;
  notes?: string;
  link?: string;
  fundingSource?: FundingSource;
  receiptStatus?: ReceiptStatus;
  charges?: AcquisitionCharge[];
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
  fundingSource?: FundingSource;
  receiptStatus?: ReceiptStatus;
  stockApplied?: boolean;
  charges?: AcquisitionCharge[];
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
  fundingSource?: FundingSource;
}
