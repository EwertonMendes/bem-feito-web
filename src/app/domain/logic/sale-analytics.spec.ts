import { describe, expect, it } from 'vitest';
import { summarizeSaleItems } from './sale-analytics';
import { SaleLineSnapshot } from '../models/sales.model';

describe('summarizeSaleItems', () => {
  it('preserves dashboard semantics for products and additions', () => {
    const items: SaleLineSnapshot[] = [
      {
        id: 'p',
        kind: 'product',
        sourceId: 'p',
        name: 'Produto',
        quantity: 2,
        unitPriceCents: 1000,
        unitCostCents: 100,
        totalCents: 2000,
        totalCostCents: 200,
      },

      {
        id: 'a',
        kind: 'addition',
        sourceId: 'a',
        name: 'Adicional',
        quantity: 3,
        unitPriceCents: 100,
        unitCostCents: 0,
        totalCents: 300,
        totalCostCents: 0,
      },
    ];

    expect(summarizeSaleItems(items)).toEqual({
      analyticsVersion: 1,
      cogsCents: 200,
      itemsSold: 2,
      missingCostItems: 0,
    });
  });

  it('counts a zero-cost product as one pending cost item regardless of quantity', () => {
    expect(summarizeSaleItems([{
      id: 'p',
      kind: 'product',
      sourceId: 'p',
      name: 'Produto',
      quantity: 5,
      unitPriceCents: 1000,
      unitCostCents: 0,
      totalCents: 5000,
      totalCostCents: 0,
    }])).toMatchObject({ itemsSold: 5, missingCostItems: 1 });
  });
});
