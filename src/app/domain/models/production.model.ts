import { AuditFields } from './common.model';

export interface ProductionConsumption {
  inputId: string;
  quantity: number;
  unitId: string;
  unitCostCents: number;
  totalCostCents: number;
}

export interface ProductionItem {
  productId: string;
  productName: string;
  quantity: number;
  unitCostCents: number;
  totalCostCents: number;
  costPending: boolean;
  consumptions: ProductionConsumption[];
}

export interface ProductionDraftItem {
  productId: string;
  quantity: number;
}

export interface Production extends AuditFields {
  /** New registrations contain multiple items; legacy registrations retain the original fields. */
  items?: ProductionItem[];
  status?: 'active' | 'cancelled';
  correctionVersion?: number;

  id: string;
  code: string;
  businessDate: string;
  productId: string;
  productName: string;
  quantity: number;
  unitCostCents: number;
  totalCostCents: number;
  costPending: boolean;
  consumptions: ProductionConsumption[];
  notes?: string;
}

export interface ProductionCorrectionDraft {
  expectedVersion: number;
  businessDate: string;
  notes: string;
  reason: string;
  cancel: boolean;
  lines: ProductionDraftItem[];
}

export interface ProductionCorrectionImpact {
  itemType: 'product' | 'input';
  itemId: string;
  name: string;
  quantityDelta: number;
  stockBefore: number;
  stockAfter: number;
  unitLabel: string;
}

export interface ProductionCorrectionPreview {
  productionId: string;
  expectedVersion: number;
  corrected: Production;
  impacts: ProductionCorrectionImpact[];
  costDeltaCents: number;
}

export interface ProductionCorrectionHistory extends AuditFields {
  id: string;
  productionId: string;
  kind: 'correction' | 'cancellation';
  businessDate: string;
  reason: string;
  before: { businessDate: string; items: ProductionItem[]; notes?: string };
  after: { businessDate: string; items: ProductionItem[]; notes?: string };
  impacts: ProductionCorrectionImpact[];
}
