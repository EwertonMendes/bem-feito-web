import { AuditFields } from './common.model';

export interface ProductionConsumption {
  inputId: string;
  quantity: number;
  unitId: string;
  unitCostCents: number;
  totalCostCents: number;
}

export interface Production extends AuditFields {
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
