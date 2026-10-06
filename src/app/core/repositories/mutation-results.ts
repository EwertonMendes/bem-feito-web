import { Expense } from '../../domain/models/finance.model';
import { StockAdjustment } from '../../domain/models/inventory.model';
import { Production } from '../../domain/models/production.model';
import { Payment, Sale } from '../../domain/models/sales.model';

export interface StockChange {
  itemType: 'product' | 'input';
  itemId: string;
  stock: number;
  averageUnitCostCents?: number;
}

export interface SaleCreateResult {
  sale: Sale;
  payments: Payment[];
  stockChanges: StockChange[];
}

export interface SalePaymentResult {
  sale: Sale;
  payment: Payment;
}

export interface SalePaymentReversalResult {
  sale: Sale;
  payment: Payment;
}

export interface SaleCancellationResult {
  sale: Sale;
  reversedPaymentIds: string[];
  stockChanges: StockChange[];
}

export interface ExpenseCreateResult {
  expense: Expense;
  stockChange?: StockChange;
}

export interface ProductionCreateResult {
  production: Production;
  stockChanges: StockChange[];
}

export interface StockAdjustmentResult {
  adjustment: StockAdjustment;
  stockChange: StockChange;
}
