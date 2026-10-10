import { trackingModeForInput } from './costing';
import { Addition, InputItem, Kit, Product } from '../models/catalog.model';
import { SaleDraft, SaleLineSnapshot, StockEffect } from '../models/sales.model';

export interface SaleResolutionCatalog {
  products: ReadonlyMap<string, Product>;
  kits: ReadonlyMap<string, Kit>;
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
      const unitCostCents = catalog.productUnitCosts.get(product.id) ?? product.averageUnitCostCents;
      lines.push({
        id: createId(),
        kind: 'product',
        sourceId: product.id,
        name: product.displayName,
        image: product.image,
        quantity: line.quantity,
        unitPriceCents,
        unitCostCents,
        totalCents: Math.round(unitPriceCents * line.quantity),
        totalCostCents: Math.round((product.unitCostDeciCents ?? unitCostCents * 10) * line.quantity / 10),
      });
      addEffect({
        itemType: 'product',
        itemId: product.id,
        quantityDelta: -line.quantity,
        unitCostCents,
        ...(product.unitCostDeciCents !== undefined ? { unitCostDeciCents: product.unitCostDeciCents } : {}),
      });
      continue;
    }

    if (line.kind === 'kit') {
      throw new Error('Kits não são vendidos. Adicione produtos individuais e aplique o desconto manual.');
    }

    const addition = catalog.additions.get(line.sourceId);
    if (!addition) throw new Error('Adicional inválido.');
    let unitCostCents = 0;

    for (const component of addition.components) {
      const input = catalog.inputs.get(component.inputId);
      if (!input) throw new Error(`Insumo inválido no adicional ${addition.name}.`);
      unitCostCents += Math.round(component.quantity * input.averageUnitCostCents);
      if (trackingModeForInput(input) !== 'untracked') {
        addEffect({
          itemType: 'input',
          itemId: input.id,
          quantityDelta: -(component.quantity * line.quantity),
          unitCostCents: input.averageUnitCostCents,
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
      unitCostCents,
      totalCents: Math.round(addition.priceCents * line.quantity),
      totalCostCents: unitCostCents * line.quantity,
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
