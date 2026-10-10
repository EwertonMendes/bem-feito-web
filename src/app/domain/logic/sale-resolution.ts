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
      const kit = catalog.kits.get(line.sourceId);
      if (!kit || !kit.active) throw new Error('Kit inativo. Adicione os produtos individualmente e aplique o desconto manual.');
      const expectedSlots = kit.components.reduce((sum, component) => sum + component.quantity, 0);
      if (line.componentProductIds.length !== expectedSlots) throw new Error(`Configure todos os itens do kit ${kit.name}.`);

      const components = [];
      let cursor = 0;
      let kitCostDeciCents = 0;

      for (const component of [...kit.components].sort((a, b) => a.order - b.order)) {
        for (let slot = 0; slot < component.quantity; slot++) {
          const productId = line.componentProductIds[cursor++];
          const product = productId ? catalog.products.get(productId) : undefined;
          if (!product) throw new Error(`Seleção inválida no kit ${kit.name}.`);
          if (product.formatId !== component.formatId) throw new Error(`Formato inválido no kit ${kit.name}.`);
          if (component.collectionId && product.collectionId !== component.collectionId) throw new Error(`Coleção inválida no kit ${kit.name}.`);
          if (component.fragranceId && product.fragranceId !== component.fragranceId) throw new Error(`Fragrância inválida no kit ${kit.name}.`);

          const componentUnitCostCents = catalog.productUnitCosts.get(product.id) ?? product.averageUnitCostCents;
          kitCostDeciCents += product.unitCostDeciCents ?? componentUnitCostCents * 10;
          components.push({
            productId: product.id,
            name: product.displayName,
            quantity: 1,
            unitCostCents: componentUnitCostCents,
          });
          addEffect({
            itemType: 'product',
            itemId: product.id,
            quantityDelta: -1,
            unitCostCents: componentUnitCostCents,
            ...(product.unitCostDeciCents !== undefined ? { unitCostDeciCents: product.unitCostDeciCents } : {}),
          });
        }
      }
      const kitCostCents = Math.round(kitCostDeciCents / 10);

      lines.push({
        id: createId(),
        kind: 'kit',
        sourceId: kit.id,
        name: kit.name,
        image: kit.image,
        quantity: 1,
        unitPriceCents: kit.priceCents,
        unitCostCents: kitCostCents,
        totalCents: kit.priceCents,
        totalCostCents: kitCostCents,
        components,
      });
      continue;
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
