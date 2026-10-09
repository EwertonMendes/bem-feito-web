import { Expense } from '../../domain/models/finance.model';
import { StockAdjustment, StockMovement } from '../../domain/models/inventory.model';
import { Production } from '../../domain/models/production.model';
import { Payment, Sale } from '../../domain/models/sales.model';

export interface StockChange {
  itemType: 'product' | 'input';
  itemId: string;
  stock: number;
  committedStock?: number;
  reservedPhysicalStock?: number;
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
  previousBalanceCents: number;
}

export interface SalePaymentReversalResult {
  sale: Sale;
  payment: Payment;
  previousBalanceCents: number;
}

export interface SaleCancellationResult {
  sale: Sale;
  previousBalanceCents: number;
  reversedPaymentIds: string[];
  stockChanges: StockChange[];
}

export interface ExpenseCreateResult {
  expense: Expense;
  stockChange?: StockChange;
  stockChanges?: StockChange[];
}

export interface ProductionCreateResult {
  production: Production;
  stockChanges: StockChange[];
}

export interface StockAdjustmentResult {
  adjustment: StockAdjustment;
  movement: StockMovement;
  stockChange: StockChange;
}

export interface SaleFulfillmentResult {
  sale: Sale;
  stockChanges: StockChange[];
}
