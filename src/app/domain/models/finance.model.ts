import { AuditFields } from './common.model';

export type ExpenseKind = 'input-purchase' | 'operating-expense' | 'equipment' | 'other';
/** Historical fundingSource is still readable during migration. */
export type FundingSource = 'business' | 'ewerton' | 'maria' | 'owner-unassigned' | 'unverified';
export type FundingType = 'business' | 'third-party' | 'unverified';
export function fundingTypeOf(expense: Pick<Expense, 'fundingType' | 'fundingSource'>): FundingType {
  if (expense.fundingType) return expense.fundingType;
  if (expense.fundingSource === 'business' || !expense.fundingSource) return 'business';
  return expense.fundingSource === 'unverified' ? 'unverified' : 'third-party';
}
export function fundingPartyOf(expense: Pick<Expense, 'paidBy' | 'fundingSource'>): string {
  if (expense.paidBy) return expense.paidBy;
  return expense.fundingSource === 'ewerton' ? 'Ewerton' : expense.fundingSource === 'maria' ? 'Maria' : '';
}
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
  fundingType?: FundingType;
  paidBy?: string;
  reimbursable?: boolean;
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
  /** Cash actually disbursed by the business; owner-funded purchases remain noncash contributions. */
  bankDebitCents?: number;
  paymentMethodId?: string;
  notes?: string;
  link?: string;
  fundingSource?: FundingSource;
  fundingType?: FundingType;
  paidBy?: string;
  reimbursable?: boolean;
  receiptStatus?: ReceiptStatus;
  stockApplied?: boolean;
  legacyUnallocatedPurchase?: boolean;
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
  fundingType?: FundingType;
  paidBy?: string;
  reimbursable?: boolean;
}
