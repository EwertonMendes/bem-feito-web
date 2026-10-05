import { AuditFields } from './common.model';

export type StockSourceType = 'sale' | 'sale-cancellation' | 'production' | 'purchase' | 'adjustment' | 'migration';

export interface StockMovement extends AuditFields {
  id: string;
  itemType: 'product' | 'input';
  itemId: string;
  quantityDelta: number;
  unitCostCents: number;
  totalCostCents: number;
  sourceType: StockSourceType;
  sourceId: string;
  businessDate: string;
  reversalOf?: string;
}

export interface StockAdjustment extends AuditFields {
  id: string;
  code: string;
  businessDate: string;
  itemType: 'product' | 'input';
  itemId: string;
  quantityDelta: number;
  reason: string;
}
