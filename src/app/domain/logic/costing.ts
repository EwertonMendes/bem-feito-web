import {
  CollectionDefinition,
  FormatDefinition,
  FragranceDefinition,
  InputItem,
  InputTrackingMode,
  CostPool,
  Product,
  RecipeComponent,
} from '../models/catalog.model';

export interface ProductCostReferences {
  collection?: CollectionDefinition;
  fragrance?: FragranceDefinition;
  format?: FormatDefinition;
}

export type CostComponentSource = 'format' | 'collection' | 'fragrance' | 'product';

export interface CostComponentContribution extends RecipeComponent {
  source: CostComponentSource;
}

export interface CostedComponent extends RecipeComponent {
  unitCostCents: number;
  totalCostCents: number;
  sources: CostComponentContribution[];
}

export interface CostEstimateLine {
  pool: CostPool;
  quantity: number;
  unitCostCents: number;
  totalCostCents: number;
}
export interface StandardProductCost {
  unitCostCents: number;
  costPending: boolean;
  components: CostedComponent[];
  /** Virtual reference costs; intentionally not physical material consumptions. */
  estimateLines?: CostEstimateLine[];
  missingReferences?: string[];
  model?: 'legacy' | 'simplified';
}

/** Purchase-weighted unit cost for one pool, independent from physical stock balances.
 * Input units inside a pool must match (e.g. grams for base, millilitres for fragrance).
 * Prices and quantities without a usable acquisition reference are excluded, never invented.
 */
export function priceForPool(pool: CostPool, inputs: ReadonlyMap<string, InputItem>): number | null {
  const candidates = [...inputs.values()].filter(input =>
    input.active && input.costPool === pool && trackingModeForInput(input) === 'untracked');
  if (!candidates.length || new Set(candidates.map(input => input.unitId)).size !== 1) return null;
  const costs = candidates.map(input => ({
    quantity: Number(input.costBasisQuantity),
    value: Number(input.costBasisValueCents),
    fallback: inputUnitCostCents(input),
  }));
  const valid = costs.filter(item => Number.isFinite(item.quantity) && item.quantity > 0 &&
    Number.isFinite(item.value) && item.value > 0);
  // When all inputs have purchase data, weight by acquired quantity.
  if (valid.length === costs.length) {
    return valid.reduce((sum, item) => sum + item.value, 0) /
      valid.reduce((sum, item) => sum + item.quantity, 0);
  }
  // Legacy prices remain usable until the real purchase references are configured.
  const rates = costs.map(item => item.fallback).filter(rate => Number.isFinite(rate) && rate > 0);
  return rates.length === costs.length ? rates.reduce((sum, rate) => sum + rate, 0) / rates.length : null;
}

export function simplifiedSoapCost(
  product: Pick<Product, 'additionalCostCents'>,
  references: ProductCostReferences,
  inputs: ReadonlyMap<string, InputItem>,
): StandardProductCost {
  const profile = references.format?.soapCostProfile;
  if (!profile) throw new Error('Perfil de custo não configurado.');
  const entries: Array<{pool: CostPool | null; quantity: number; label: string}> = [
    {pool: 'base', quantity: profile.baseGrams, label: 'Glicerina base (g)'},
    {pool: 'surfactant', quantity: profile.surfactantMl, label: 'Lauril (ml)'},
    {pool: references.collection?.fragranceCostPool ?? null, quantity: profile.fragranceMl, label: 'Grupo de essências da coleção'},
    {pool: 'colorant', quantity: profile.colorantMl, label: 'Corantes (ml)'},
  ];
  const missingReferences: string[] = [];
  const estimateLines: CostEstimateLine[] = [];
  let total = Math.max(0, Number(product.additionalCostCents ?? 0)) +
    Math.max(0, Number(profile.extraUnitCostCents ?? 0));
  if (!Number.isFinite(profile.baseGrams) || profile.baseGrams <= 0) missingReferences.push('Quantidade padrão de glicerina');
  for (const entry of entries) {
    if (!Number.isFinite(entry.quantity) || entry.quantity < 0) {
      missingReferences.push('Quantidade inválida: ' + entry.label);
      continue;
    }
    if (!entry.quantity) continue;
    const unitCost = entry.pool ? priceForPool(entry.pool, inputs) : null;
    if (unitCost === null || unitCost <= 0) {
      missingReferences.push('Preço de referência: ' + entry.label);
      continue;
    }
    total += unitCost * entry.quantity;
    estimateLines.push({pool: entry.pool!, quantity: entry.quantity,
      unitCostCents: unitCost, totalCostCents: Math.round(unitCost * entry.quantity)});
  }
  return {
    unitCostCents: Math.round(total),
    costPending: missingReferences.length > 0,
    components: [],
    estimateLines,
    missingReferences,
    model: 'simplified',
  };
}

export function trackingModeForInput(
  input: Pick<InputItem, 'trackingMode' | 'minimumStockConfigured'>,
): InputTrackingMode {
  if (input.trackingMode) return input.trackingMode;
  return input.minimumStockConfigured === false ? 'untracked' : 'estimated';
}

/** Average acquisition price is independent of remaining physical stock. */
export function inputUnitCostCents(input: Pick<InputItem, 'averageUnitCostCents' | 'costBasisQuantity' | 'costBasisValueCents'>): number {
  const quantity = Number(input.costBasisQuantity);
  const value = Number(input.costBasisValueCents);
  if (Number.isFinite(quantity) && quantity > 0 && Number.isSafeInteger(value) && value >= 0) return value / quantity;
  return Math.max(0, Number(input.averageUnitCostCents || 0));
}

export function productCostBreakdown(
  product: Pick<Product, 'recipe'>,
  references: ProductCostReferences,
): Array<RecipeComponent & { sources: CostComponentContribution[] }> {
  const aggregated = new Map<string, RecipeComponent & { sources: CostComponentContribution[] }>();
  const source: CostComponentContribution[] = [
    ...(references.format?.costComponents ?? []).map((component) => ({ ...component, source: 'format' as const })),
    ...(references.collection?.costComponents ?? []).map((component) => ({ ...component, source: 'collection' as const })),
    ...(references.fragrance?.costComponents ?? []).map((component) => ({ ...component, source: 'fragrance' as const })),
    ...product.recipe.map((component) => ({ ...component, source: 'product' as const })),
  ];

  for (const component of source) {
    if (!component.inputId || !component.unitId || !Number.isFinite(component.quantity) || component.quantity <= 0) continue;
    const key = `${component.inputId}:${component.unitId}`;
    const previous = aggregated.get(key);
    aggregated.set(key, {
      inputId: component.inputId,
      unitId: component.unitId,
      quantity: (previous?.quantity ?? 0) + component.quantity,
      sources: [...(previous?.sources ?? []), component],
    });
  }
  return [...aggregated.values()];
}

export function productCostComponents(
  product: Pick<Product, 'recipe'>,
  references: ProductCostReferences,
): RecipeComponent[] {
  return productCostBreakdown(product, references).map(({ sources: _sources, ...component }) => component);
}

export function standardCostForProduct(
  product: Pick<Product, 'recipe' | 'additionalCostCents' | 'averageUnitCostCents'>,
  references: ProductCostReferences,
  inputs: ReadonlyMap<string, InputItem>,
): StandardProductCost {
  // Explicit opt-in: previous documents and historic productions keep their original costing.
  // A configured profile replaces fixed ingredient/colour recipes; never double-count both.
  if (references.format?.soapCostProfile) return simplifiedSoapCost(product, references, inputs);
  const definitions = productCostBreakdown(product, references);
  if (!definitions.length) {
    const fallback = Math.max(0, Math.round(product.additionalCostCents || product.averageUnitCostCents || 0));
    return { unitCostCents: fallback, costPending: fallback <= 0, components: [], model: 'legacy',
      missingReferences: fallback <= 0 ? ['Custo padrão do produto'] : [] };
  }

  let costPending = false;
  let rawUnitCostCents = Math.max(0, Number(product.additionalCostCents || 0));
  const components: CostedComponent[] = [];
  for (const definition of definitions) {
    const input = inputs.get(definition.inputId);
    if (!input) throw new Error('A composição de custo contém um insumo inválido.');
    if (input.unitId !== definition.unitId) throw new Error(`Unidade incompatível para ${input.name}.`);
    const inputCost = inputUnitCostCents(input);
    const componentCost = Math.round(definition.quantity * inputCost);
    if (inputCost <= 0) costPending = true;
    rawUnitCostCents += definition.quantity * inputCost;
    components.push({ ...definition, unitCostCents: Math.round(inputCost), totalCostCents: componentCost });
  }
  return { unitCostCents: Math.round(rawUnitCostCents), costPending, components, model: 'legacy',
    missingReferences: costPending ? components.filter(item => item.unitCostCents <= 0)
      .map(item => inputs.get(item.inputId)?.name ?? 'Insumo sem preço') : [] };
}
