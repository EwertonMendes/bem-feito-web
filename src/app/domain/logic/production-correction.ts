import { Production, ProductionConsumption, ProductionDraftItem, ProductionItem } from '../models/production.model';

export interface ProductionStockDelta { itemId: string; quantityDelta: number; }

export function productionItems(production: Production): ProductionItem[] {
  return production.items?.length ? production.items : [{
    productId: production.productId, productName: production.productName,
    quantity: production.quantity, unitCostCents: production.unitCostCents,
    totalCostCents: production.totalCostCents, costPending: production.costPending,
    consumptions: production.consumptions ?? [],
  }];
}

export function roundQuantity(quantity: number): number {
  return Math.round(quantity * 1e6) / 1e6;
}

export function aggregateProductionConsumptions(items: readonly ProductionItem[]): ProductionConsumption[] {
  const all = new Map<string, ProductionConsumption>();
  for (const item of items) for (const consumption of item.consumptions) {
    const previous = all.get(consumption.inputId);
    if (previous && previous.unitId !== consumption.unitId) throw new Error('Unidades incompatíveis para o mesmo insumo.');
    all.set(consumption.inputId, previous ? {
      ...previous,
      quantity: roundQuantity(previous.quantity + consumption.quantity),
      totalCostCents: previous.totalCostCents + consumption.totalCostCents,
    } : { ...consumption });
  }
  return [...all.values()];
}

export function scaleHistoricProductionItem(item: ProductionItem, quantity: number): ProductionItem {
  if (quantity === item.quantity) return { ...item, consumptions: item.consumptions.map(c => ({ ...c })) };
  return {
    ...item, quantity,
    totalCostCents: Math.round(item.totalCostCents * quantity / item.quantity),
    consumptions: item.consumptions.map(c => ({
      ...c, quantity: roundQuantity(c.quantity * quantity / item.quantity),
      totalCostCents: Math.round(c.totalCostCents * quantity / item.quantity),
    })),
  };
}

export function normalizeProductionDraft(lines: readonly ProductionDraftItem[]): ProductionDraftItem[] {
  if (!lines.length || lines.length > 60) throw new Error('Informe de 1 a 60 itens.');
  const totals = new Map<string, number>();
  for (const line of lines) {
    if (!line.productId || !Number.isSafeInteger(line.quantity) || line.quantity <= 0)
      throw new Error('Selecione o sabonete e informe uma quantidade inteira positiva.');
    totals.set(line.productId, (totals.get(line.productId) ?? 0) + line.quantity);
  }
  if ([...totals.values()].some(q => !Number.isSafeInteger(q) || q > 1000000))
    throw new Error('Quantidade acima do limite permitido.');
  return [...totals].map(([productId, quantity]) => ({ productId, quantity }));
}

export function productionQuantityDeltas(before: readonly ProductionItem[], after: readonly ProductionItem[]): ProductionStockDelta[] {
  const values = new Map<string, number>();
  for (const item of before) values.set(item.productId, (values.get(item.productId) ?? 0) - item.quantity);
  for (const item of after) values.set(item.productId, (values.get(item.productId) ?? 0) + item.quantity);
  return [...values].filter(([, delta]) => delta !== 0).map(([itemId, quantityDelta]) => ({ itemId, quantityDelta }));
}

/** Estimated stock can be partially consumed; never refund units that were never debited. */
export function inputCorrectionDelta(beforeRequired: number, afterRequired: number, actuallyDebited: number, currentAvailable: number, exact: boolean): number {
  if (afterRequired < beforeRequired) return roundQuantity(Math.max(0, actuallyDebited - afterRequired));
  if (afterRequired > beforeRequired) {
    const extra = roundQuantity(afterRequired - beforeRequired);
    if (exact && extra > currentAvailable + 1e-6) throw new Error('Estoque de insumo controlado insuficiente.');
    return -roundQuantity(exact ? extra : Math.min(currentAvailable, extra));
  }
  return 0;
}
