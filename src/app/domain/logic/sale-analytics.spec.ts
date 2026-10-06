import { describe, expect, it } from 'vitest';
import { summarizeSaleItems } from './sale-analytics';
import { SaleLineSnapshot } from '../models/sales.model';

describe('summarizeSaleItems', () => {
  it('preserves dashboard semantics for products, kits and additions', () => {
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
        id: 'k',
        kind: 'kit',
        sourceId: 'k',
        name: 'Kit',
        quantity: 1,
        unitPriceCents: 1800,
        unitCostCents: 100,
        totalCents: 1800,
        totalCostCents: 100,
        components: [
          { productId: 'a', name: 'A', quantity: 1, unitCostCents: 100 },
          { productId: 'b', name: 'B', quantity: 2, unitCostCents: 0 },
        ],
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
      cogsCents: 300,
      itemsSold: 5,
      missingCostItems: 1,
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
