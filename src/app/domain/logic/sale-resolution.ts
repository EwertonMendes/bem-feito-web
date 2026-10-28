import { inputUnitCostCents, trackingModeForInput } from './costing';
import { productCategoryId } from './product-category';
import { Addition, InputItem, Product } from '../models/catalog.model';
import { SaleDraft, SaleLineSnapshot, StockEffect } from '../models/sales.model';

export interface SaleResolutionCatalog {
  products: ReadonlyMap<string, Product>;
  additions: ReadonlyMap<string, Addition>;
  inputs: ReadonlyMap<string, InputItem>;
  productUnitCosts: ReadonlyMap<string, number>;
}

export interface ResolvedSaleDraft {
  lines: SaleLineSnapshot[];
  stockEffects: StockEffect[];
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
}

export function resolveSaleDraft(
  draft: SaleDraft,
  catalog: SaleResolutionCatalog,
  createId: () => string = () => crypto.randomUUID(),
): ResolvedSaleDraft {
  const lines: SaleLineSnapshot[] = [];
  const effects = new Map<string, StockEffect>();

  const addEffect = (effect: StockEffect): void => {
    const key = `${effect.itemType}:${effect.itemId}`;
    const current = effects.get(key);
    effects.set(key, current ? { ...current, quantityDelta: current.quantityDelta + effect.quantityDelta } : effect);
  };

  for (const line of draft.lines) {
    if (!Number.isFinite(line.quantity) || line.quantity <= 0) throw new Error('Há um item com quantidade inválida.');

    if (line.kind === 'product') {
      const product = catalog.products.get(line.sourceId);
      if (!product) throw new Error('Produto inválido.');
      const unitPriceCents = line.manualUnitPriceCents ?? product.salePriceCents;
      if (!Number.isSafeInteger(unitPriceCents) || unitPriceCents < 0)
        throw new Error('O preço unitário precisa ser um valor válido em centavos.');
      const unitCostCents = product.costingVersion === 2
        ? product.averageUnitCostCents
        : (catalog.productUnitCosts.get(product.id) ?? product.averageUnitCostCents);
      const deciCents = product.costingVersion === 2
        ? unitCostCents * 10 : (product.unitCostDeciCents ?? unitCostCents * 10);
      lines.push({
        id: createId(),
        kind: 'product',
        sourceId: product.id,
        name: product.displayName,
        image: product.image,
        quantity: line.quantity,
        unitPriceCents,
        unitCostCents,
        categoryId: productCategoryId(product),
        ...(productCategoryId(product) === 'soap' ? { collectionId: product.collectionId, fragranceId: product.fragranceId, formatId: product.formatId } : {}),
        stockEffects: [{ itemType: 'product', itemId: product.id, quantityDelta: -line.quantity,
          unitCostCents, unitCostDeciCents: deciCents }],
        totalCents: Math.round(unitPriceCents * line.quantity),
        totalCostCents: Math.round(deciCents * line.quantity / 10),
      });
      addEffect({
        itemType: 'product',
        itemId: product.id,
        quantityDelta: -line.quantity,
        unitCostCents,
        unitCostDeciCents: deciCents,
      });
      continue;
    }


    const addition = catalog.additions.get(line.sourceId);
    if (!addition) throw new Error('Adicional inválido.');
    let unitCostCents = 0;
    const lineEffects: StockEffect[] = [];

    for (const component of addition.components) {
      const input = catalog.inputs.get(component.inputId);
      if (!input) throw new Error(`Insumo inválido no adicional ${addition.name}.`);
      unitCostCents += component.quantity * inputUnitCostCents(input);
      if (trackingModeForInput(input) !== 'untracked') {
        lineEffects.push({itemType:'input',itemId:input.id,quantityDelta:-(component.quantity * line.quantity),unitCostCents:Math.round(inputUnitCostCents(input))});
        addEffect({
          itemType: 'input',
          itemId: input.id,
          quantityDelta: -(component.quantity * line.quantity),
          unitCostCents: Math.round(inputUnitCostCents(input)),
        });
      }
    }

    lines.push({
      id: createId(),
      kind: 'addition',
      sourceId: addition.id,
      name: addition.name,
      image: addition.image,
      quantity: line.quantity,
      unitPriceCents: addition.priceCents,
      unitCostCents: Math.round(unitCostCents),
      stockEffects: lineEffects,
      totalCents: Math.round(addition.priceCents * line.quantity),
      totalCostCents: Math.round(unitCostCents * line.quantity),
    });
  }

  const stockEffects: StockEffect[] = [];
  for (const effect of effects.values()) {
    const entity = effect.itemType === 'product'
      ? catalog.products.get(effect.itemId)
      : catalog.inputs.get(effect.itemId);
    if (!entity) throw new Error('Item de estoque não encontrado.');

    // Orders awaiting production commit full demand, even before physical stock exists.
    if (draft.fulfillmentStatus === 'in-production') {
      stockEffects.push(effect);
      continue;
    }

    if (effect.itemType === 'input' && trackingModeForInput(entity as InputItem) === 'estimated') {
      const available = Math.max(0, entity.stock);
      const requested = Math.abs(effect.quantityDelta);
      const applied = Math.min(available, requested);
      if (applied > 0) stockEffects.push({ ...effect, quantityDelta: -applied });
      continue;
    }

    if (entity.stock + effect.quantityDelta < 0) {
      const name = 'displayName' in entity ? entity.displayName : entity.name;
      throw new Error(`Estoque insuficiente de ${name}.`);
    }
    stockEffects.push(effect);
  }

  const subtotalCents = lines.reduce((sum, line) => sum + line.totalCents, 0);
  const discountCents = Math.min(Math.max(0, draft.discountCents), subtotalCents);
  const totalCents = Math.max(0, subtotalCents - discountCents);

  return { lines, stockEffects, subtotalCents, discountCents, totalCents };
}
