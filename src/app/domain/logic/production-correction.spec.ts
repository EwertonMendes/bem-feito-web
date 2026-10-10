import { describe, expect, it } from 'vitest';
import {
  aggregateProductionConsumptions, inputCorrectionDelta, normalizeProductionDraft,
  productionItems, productionQuantityDeltas, scaleHistoricProductionItem,
} from './production-correction';
import { ProductionItem } from '../models/production.model';

const part = (id: string, qty: number): ProductionItem => ({
  productId: id, productName: id, quantity: qty, unitCostCents: 100,
  totalCostCents: qty * 100, costPending: false,
  consumptions: [{ inputId: 'base', quantity: qty * 2, unitId: 'g', unitCostCents: 50, totalCostCents: qty * 100 }],
});

describe('production corrections', () => {
  it('scales the original historical recipe and costs rather than the current recipe', () => {
    expect(scaleHistoricProductionItem(part('lavender', 10), 15)).toMatchObject({
      quantity: 15, totalCostCents: 1500, consumptions: [{ quantity: 30, totalCostCents: 1500 }],
    });
    expect(part('lavender', 10).quantity).toBe(10);
  });
  it('aggregates product changes when replacing the selected soap', () => {
    expect(productionQuantityDeltas([part('lavender', 20)], [part('peach', 20)])).toEqual([
      { itemId: 'lavender', quantityDelta: -20 }, { itemId: 'peach', quantityDelta: 20 },
    ]);
    expect(productionQuantityDeltas([part('lavender', 20)], [part('lavender', 20)])).toEqual([]);
  });
  it('aggregates input use without losing unit details', () => {
    expect(aggregateProductionConsumptions([part('a', 3), part('b', 2)])).toMatchObject([{ quantity: 10, totalCostCents: 500 }]);
    expect(() => aggregateProductionConsumptions([part('a', 1), {
      ...part('b', 1), consumptions: [{ inputId: 'base', unitId: 'ml', quantity: 1, unitCostCents: 50, totalCostCents: 50 }],
    }])).toThrow('Unidades incompatíveis');
  });
  it('never returns estimated raw materials that were never debited', () => {
    expect(inputCorrectionDelta(10, 8, 5, 0, false)).toBe(0);
    expect(inputCorrectionDelta(10, 2, 5, 0, false)).toBe(3);
    expect(inputCorrectionDelta(10, 0, 5, 0, false)).toBe(5);
    expect(inputCorrectionDelta(10, 12, 5, 1, false)).toBe(-1);
  });
  it('blocks strict stock deficits but allows a full cancellation credit', () => {
    expect(() => inputCorrectionDelta(10, 15, 10, 4, true)).toThrow();
    expect(inputCorrectionDelta(10, 0, 10, 0, true)).toBe(10);
  });
  it('combines duplicate form rows and rejects invalid quantities', () => {
    expect(normalizeProductionDraft([{ productId: 'a', quantity: 2 }, { productId: 'a', quantity: 3 }]))
      .toEqual([{ productId: 'a', quantity: 5 }]);
    expect(() => normalizeProductionDraft([{ productId: 'a', quantity: 0 }])).toThrow();
  });
  it('adapts legacy single-item entries into the same correction structure', () => {
    const item = part('lavender', 2);
    expect(productionItems({
      id: 'p', code: 'PR1', businessDate: '2026-10-05',
      ...item, productName: 'lavender', consumptions: item.consumptions,
    })).toEqual([item]);
  });
});
