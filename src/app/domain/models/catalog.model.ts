import { AuditFields } from './common.model';
import { CatalogImageRef } from './image.model';

export type StockStatus = 'negative' | 'low' | 'ok' | 'untracked';
export type InputTrackingMode = 'exact' | 'estimated' | 'untracked';

export interface RecipeComponent {
  inputId: string;
  quantity: number;
  unitId: string;
}

export interface Product extends AuditFields {
  id: string;
  code: string;
  active: boolean;
  collectionId: string;
  fragranceId: string;
  formatId: string;
  displayName: string;
  salePriceCents: number;
  additionalCostCents: number;
  averageUnitCostCents: number;
  /** Tenths of a cent, preserving historical R$0.264/R$0.384 unit costs. */
  unitCostDeciCents?: number;
  stock: number;
  /** Units committed to open orders, including those still requiring production. */
  committedStock?: number;
  minimumStock: number;
  stockStatus?: StockStatus;
  image?: CatalogImageRef;
  recipe: RecipeComponent[];
}

export interface InputItem extends AuditFields {
  id: string;
  code: string;
  active: boolean;
  name: string;
  unitId: string;
  stock: number;
  committedStock?: number;
  minimumStock: number;
  minimumStockConfigured?: boolean;
  trackingMode?: InputTrackingMode;
  stockStatus?: StockStatus;
  averageUnitCostCents: number;
  costBasisQuantity?: number;
  costBasisValueCents?: number;
  image?: CatalogImageRef;
}

export interface KitComponent {
  id: string;
  formatId: string;
  quantity: number;
  collectionId?: string;
  fragranceId?: string;
  order: number;
}

export interface Kit extends AuditFields {
  id: string;
  active: boolean;
  name: string;
  priceCents: number;
  notes?: string;
  image?: CatalogImageRef;
  components: KitComponent[];
}

export interface AdditionComponent {
  id: string;
  inputId: string;
  quantity: number;
  unitId: string;
  order: number;
}

export interface Addition extends AuditFields {
  id: string;
  active: boolean;
  name: string;
  category: string;
  priceCents: number;
  notes?: string;
  image?: CatalogImageRef;
  components: AdditionComponent[];
}

export interface CollectionDefinition extends AuditFields {
  id: string;
  name: string;
  active: boolean;
  costComponents?: RecipeComponent[];
}

export interface FragranceDefinition extends AuditFields {
  id: string;
  name: string;
  collectionId: string;
  active: boolean;
  costComponents?: RecipeComponent[];
}

export interface FormatDefinition extends AuditFields {
  id: string;
  name: string;
  active: boolean;
  approximateWeightGrams?: number;
  costComponents?: RecipeComponent[];
}

export interface FormatPrice extends AuditFields {
  id: string;
  collectionId: string;
  formatId: string;
  priceCents: number;
  active: boolean;
}

export interface UnitDefinition extends AuditFields {
  id: string;
  name: string;
  active: boolean;
}

export interface PaymentMethod extends AuditFields {
  id: string;
  name: string;
  active: boolean;
}

export interface ExpenseCategory extends AuditFields {
  id: string;
  name: string;
  active: boolean;
}

export interface ExpenseType extends AuditFields {
  id: string;
  name: string;
  active: boolean;
  kind: 'input-purchase' | 'operating-expense' | 'equipment' | 'other';
}
