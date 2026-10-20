import { AuditFields } from './common.model';
import { CatalogImageRef } from './image.model';

export type SaleStatus = 'active' | 'cancelled';
/** Commercial fulfillment is independent from payment and cancellation. */
export type FulfillmentStatus = 'in-production' | 'ready' | 'delivered';
export type PaymentStatus = 'paid' | 'pending' | 'partial' | 'cancelled';
export type SaleLineKind = 'product' | 'addition';

export interface SaleLineSnapshot {
  id: string;
  kind: SaleLineKind;
  sourceId: string;
  name: string;
  image?: CatalogImageRef;
  quantity: number;
  unitPriceCents: number;
  unitCostCents: number;
  totalCents: number;
  totalCostCents: number;
  /** Immutable classification at sale time, unaffected by later catalog changes. */
  categoryId?: 'soap' | 'creative-kit' | 'scented-candle';
  collectionId?: string;
  fragranceId?: string;
  formatId?: string;
  /** Per-line inventory provenance; required to change existing additions safely. */
  stockEffects?: StockEffect[];
}

export interface StockEffect {
  itemType: 'product' | 'input';
  itemId: string;
  quantityDelta: number;
  unitCostCents: number;
  unitCostDeciCents?: number;
}

export interface OrderLineAllocation {
  /** Immutable sale line identifier; never allocate by display name. */
  lineId: string;
  productId: string;
  quantity: number;
}

export interface Sale extends AuditFields {
  id: string;
  code: string;
  businessDate: string;
  customerName?: string;
  /** Indexed normalized key for history search. Legacy documents may not have it yet. */
  customerSearchKey?: string;
  customerSearchPrefixes?: string[];
  productIds?: string[];
  dueDate?: string;
  discountCents: number;
  subtotalCents: number;
  totalCents: number;
  receivedCents: number;
  tipCents: number;
  balanceCents: number;
  paymentStatus: PaymentStatus;
  status: SaleStatus;
  notes?: string;
  items: SaleLineSnapshot[];
  paymentIds: string[];
  stockEffects: StockEffect[];
  /** Explicit reservations per order. Absent means legacy allocation must be reconciled. */
  orderAllocations?: OrderLineAllocation[];
  /** Legacy sales without this field are considered delivered. */
  fulfillmentStatus?: FulfillmentStatus;
  /** False for orders that reserve inventory until delivery. Legacy sales are true. */
  stockApplied?: boolean;
  analyticsVersion?: 1;
  cogsCents?: number;
  itemsSold?: number;
  missingCostItems?: number;
  cancelledAt?: unknown;
  cancelledBy?: string;
}

export interface Payment extends AuditFields {
  id: string;
  code: string;
  saleId: string;
  businessDate: string;
  methodId: string;
  amountReceivedCents: number;
  appliedCents: number;
  tipCents: number;
  status: 'active' | 'reversed';
  notes?: string;
  reversalOf?: string;
}

export interface ProductSaleDraftLine {
  kind: 'product';
  sourceId: string;
  quantity: number;
  manualUnitPriceCents?: number;
}

export interface AdditionSaleDraftLine {
  kind: 'addition';
  sourceId: string;
  quantity: number;
}

export type SaleDraftLine = ProductSaleDraftLine | AdditionSaleDraftLine;

export interface PaymentDraft {
  methodId: string;
  amountReceivedCents: number;
}

export interface SaleDraft {
  businessDate: string;
  customerName?: string;
  dueDate?: string;
  discountCents: number;
  notes?: string;
  lines: SaleDraftLine[];
  payments: PaymentDraft[];
  fulfillmentStatus?: FulfillmentStatus;
}
