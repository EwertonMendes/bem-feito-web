import { AuditFields } from './common.model';
import { CatalogImageRef } from './image.model';

export type SaleStatus = 'active' | 'cancelled';
export type PaymentStatus = 'paid' | 'pending' | 'partial' | 'cancelled';
export type SaleLineKind = 'product' | 'kit' | 'addition';

export interface SaleResolvedComponent {
  productId: string;
  name: string;
  quantity: number;
  unitCostCents: number;
}

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
  components?: SaleResolvedComponent[];
}

export interface StockEffect {
  itemType: 'product' | 'input';
  itemId: string;
  quantityDelta: number;
  unitCostCents: number;
}

export interface Sale extends AuditFields {
  id: string;
  code: string;
  businessDate: string;
  customerName?: string;
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

export interface KitSaleDraftLine {
  kind: 'kit';
  sourceId: string;
  quantity: 1;
  componentProductIds: string[];
}

export interface AdditionSaleDraftLine {
  kind: 'addition';
  sourceId: string;
  quantity: number;
}

export type SaleDraftLine = ProductSaleDraftLine | KitSaleDraftLine | AdditionSaleDraftLine;

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
}
