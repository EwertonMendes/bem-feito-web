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
