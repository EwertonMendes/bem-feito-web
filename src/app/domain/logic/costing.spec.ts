import { describe, expect, it } from 'vitest';
import { productCostComponents, standardCostForProduct, trackingModeForInput } from './costing';
import { InputItem, Product } from '../models/catalog.model';

const product: Product = {
  id: 'p',
  code: 'P',
  active: true,
  collectionId: 'c',
  fragranceId: 'f',
  formatId: 'fmt',
  displayName: 'Produto',
  salePriceCents: 1000,
  additionalCostCents: 50,
  averageUnitCostCents: 0,
  stock: 0,
  minimumStock: 0,
  recipe: [{ inputId: 'extra', unitId: 'ml', quantity: 1 }],
};

const input = (id: string, cost: number): InputItem => ({
  id,
  code: id,
  active: true,
  name: id,
  unitId: id === 'base' ? 'g' : 'ml',
  stock: 0,
  minimumStock: 0,
  trackingMode: 'estimated',
  averageUnitCostCents: cost,
});

describe('standard costing', () => {
  it('composes reusable format, collection, fragrance and product adjustments', () => {
    const components = productCostComponents(product, {
      format: { id: 'fmt', name: 'Barra', active: true, costComponents: [{ inputId: 'base', unitId: 'g', quantity: 90 }] },
      collection: { id: 'c', name: 'Clássica', active: true, costComponents: [{ inputId: 'extra', unitId: 'ml', quantity: 2 }] },
      fragrance: { id: 'f', name: 'Lavanda', collectionId: 'c', active: true, costComponents: [{ inputId: 'extra', unitId: 'ml', quantity: 3 }] },
    });
    expect(components).toEqual([
      { inputId: 'base', unitId: 'g', quantity: 90 },
      { inputId: 'extra', unitId: 'ml', quantity: 6 },
    ]);
  });

  it('calculates standard unit cost without depending on physical stock', () => {
    const inputs = new Map([
      ['base', input('base', 2)],
      ['extra', input('extra', 10)],
    ]);
    const result = standardCostForProduct(product, {
      format: { id: 'fmt', name: 'Barra', active: true, costComponents: [{ inputId: 'base', unitId: 'g', quantity: 90 }] },
    }, inputs);
    expect(result.unitCostCents).toBe(240);
    expect(result.costPending).toBe(false);
  });

  it('treats legacy tracked inputs as estimated and explicit untracked inputs as untracked', () => {
    expect(trackingModeForInput({})).toBe('estimated');
    expect(trackingModeForInput({ minimumStockConfigured: false })).toBe('untracked');
    expect(trackingModeForInput({ trackingMode: 'exact' })).toBe('exact');
  });
});
