import { AuditFields } from './common.model';
import { CatalogImageRef } from './image.model';

export type StockStatus = 'negative' | 'low' | 'ok' | 'untracked';
export type InputTrackingMode = 'exact' | 'estimated' | 'untracked';

/** A purchase-funded reference rate, not a physical recipe or inventory balance. */
export type CostPool = 'base' | 'surfactant' | 'fragrance-classic' | 'fragrance-premium' | 'colorant';

/** Reference amounts per finished soap. They never debit production-material stock. */
export interface SoapCostProfile {
  baseGrams: number;
  surfactantMl: number;
  fragranceMl: number;
  colorantMl: number;
  extraUnitCostCents?: number;
}

export interface RecipeComponent {
  inputId: string;
  quantity: number;
  unitId: string;
}

export interface Product extends AuditFields {
  id: string;
  code: string;
  active: boolean;
  /** Historical documents without this field are soap products. */
  categoryId?: 'soap' | 'creative-kit' | 'scented-candle';
  modelName?: string;
  variantName?: string;
  description?: string;
  volumeMl?: number;
  /** Reference to Mais Aroma fragrance for candle variants; historical names remain in variantName. */
  candleFragranceId?: string;
  collectionId: string;
  fragranceId: string;
  formatId: string;
  displayName: string;
  salePriceCents: number;
  additionalCostCents: number;
  averageUnitCostCents: number;
  /** Set only when a production has adopted the reference-cost model. */
  costingVersion?: 2;
  /** Tenths of a cent, preserving historical R$0.264/R$0.384 unit costs. */
  unitCostDeciCents?: number;
  stock: number;
  /** Units committed to open orders, including those still requiring production. */
  committedStock?: number;
  /** Physical pieces assigned to commitments; the rest requires production. */
  reservedPhysicalStock?: number;
  /** Open commitments created with explicit order-line tracking. Legacy orders remain outside this counter. */
  explicitCommittedStock?: number;
  /** Physical pieces allocated explicitly to tracked order lines. */
  explicitAllocatedStock?: number;
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
  reservedPhysicalStock?: number;
  minimumStock: number;
  minimumStockConfigured?: boolean;
  trackingMode?: InputTrackingMode;
  /** Optional reference cost group: mixtures are priced as a pool, not a fixed colour or fragrance. */
  costPool?: CostPool;
  /** Audit metadata when an obsolete physical balance ceases to be tracked. */
  untrackedSince?: string;
  previousPhysicalStock?: number;
  previousTrackingMode?: InputTrackingMode;
  /** Qualitative status for non-measurable liquids; never treated as a numerical balance. */
  availabilityStatus?: string;
  stockStatus?: StockStatus;
  averageUnitCostCents: number;
  costBasisQuantity?: number;
  costBasisValueCents?: number;
  image?: CatalogImageRef;
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
  /** Identifies which essence-price pool this collection normally uses. */
  fragranceCostPool?: 'fragrance-classic' | 'fragrance-premium';
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
  /** Optional simplified reference model, independent of any physical input balance. */
  soapCostProfile?: SoapCostProfile;
  costComponents?: RecipeComponent[];
}

/** Commercial candle configuration, independent of soap recipes/pricing. */
export interface CandleModel extends AuditFields {
  id: string;
  name: string;
  volumeMl: number;
  priceCents: number;
  sourceCollectionId: string;
  active: boolean;
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
