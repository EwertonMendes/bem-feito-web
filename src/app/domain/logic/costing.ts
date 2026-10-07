import {
  CollectionDefinition,
  FormatDefinition,
  FragranceDefinition,
  InputItem,
  InputTrackingMode,
  Product,
  RecipeComponent,
} from '../models/catalog.model';

export interface ProductCostReferences {
  collection?: CollectionDefinition;
  fragrance?: FragranceDefinition;
  format?: FormatDefinition;
}

export interface CostedComponent extends RecipeComponent {
  unitCostCents: number;
  totalCostCents: number;
}

export interface StandardProductCost {
  unitCostCents: number;
  costPending: boolean;
  components: CostedComponent[];
}

export function trackingModeForInput(
  input: Pick<InputItem, 'trackingMode' | 'minimumStockConfigured'>,
): InputTrackingMode {
  if (input.trackingMode) return input.trackingMode;
  return input.minimumStockConfigured === false ? 'untracked' : 'estimated';
}

export function productCostComponents(
  product: Pick<Product, 'recipe'>,
  references: ProductCostReferences,
): RecipeComponent[] {
  const aggregated = new Map<string, RecipeComponent>();
  const source = [
    ...(references.format?.costComponents ?? []),
    ...(references.collection?.costComponents ?? []),
    ...(references.fragrance?.costComponents ?? []),
    ...product.recipe,
  ];

  for (const component of source) {
    if (!component.inputId || !component.unitId || !Number.isFinite(component.quantity) || component.quantity <= 0) continue;
    const key = `${component.inputId}:${component.unitId}`;
    const previous = aggregated.get(key);
    aggregated.set(key, {
      inputId: component.inputId,
      unitId: component.unitId,
      quantity: (previous?.quantity ?? 0) + component.quantity,
    });
  }
  return [...aggregated.values()];
}

export function standardCostForProduct(
  product: Pick<Product, 'recipe' | 'additionalCostCents' | 'averageUnitCostCents'>,
  references: ProductCostReferences,
  inputs: ReadonlyMap<string, InputItem>,
): StandardProductCost {
  const definitions = productCostComponents(product, references);
  if (!definitions.length) {
    const fallback = Math.max(0, Math.round(product.additionalCostCents || product.averageUnitCostCents || 0));
    return { unitCostCents: fallback, costPending: fallback <= 0, components: [] };
  }

  let costPending = false;
  let unitCostCents = Math.max(0, Math.round(product.additionalCostCents || 0));
  const components: CostedComponent[] = [];
  for (const definition of definitions) {
    const input = inputs.get(definition.inputId);
    if (!input) throw new Error('A composição de custo contém um insumo inválido.');
    if (input.unitId !== definition.unitId) throw new Error(`Unidade incompatível para ${input.name}.`);
    const inputCost = Math.max(0, Number(input.averageUnitCostCents || 0));
    const componentCost = Math.round(definition.quantity * inputCost);
    if (inputCost <= 0) costPending = true;
    unitCostCents += componentCost;
    components.push({ ...definition, unitCostCents: inputCost, totalCostCents: componentCost });
  }
  return { unitCostCents: Math.round(unitCostCents), costPending, components };
}
