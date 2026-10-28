import { describe, expect, it } from 'vitest';
import { productCostBreakdown, productCostComponents, standardCostForProduct, priceForPool, trackingModeForInput, inputUnitCostCents } from './costing';
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
  it('calculates an aromatic mixture without choosing a fixed colour or perfume', () => {
    const make = (id: string, pool: NonNullable<InputItem['costPool']>, qty: number, cents: number, unit: string): InputItem => ({
      ...input(id, 0), costPool: pool, unitId: unit, trackingMode: 'untracked',
      costBasisQuantity: qty, costBasisValueCents: cents, costUnitFactor: 1,
    });
    const inputs = new Map<string, InputItem>([
      ['white-base', make('white-base', 'base', 1000, 3000, 'g')],
      ['lauril', make('lauril', 'surfactant', 100, 1000, 'ml')],
      ['essence-a', make('essence-a', 'fragrance-classic', 100, 2000, 'ml')],
      ['essence-b', make('essence-b', 'fragrance-classic', 100, 4000, 'ml')],
      ['blue', make('blue', 'colorant', 20, 400, 'ml')],
      ['red', make('red', 'colorant', 20, 800, 'ml')],
    ]);
    const cost = standardCostForProduct(product, {
      collection: {id:'col',name:'Clássica',active:true,fragranceCostPool:'fragrance-classic'},
      format: {id:'fmt',name:'Floral',active:true,soapCostProfile:{
        baseGrams: 90, surfactantMl: 1, fragranceMl: 2, colorantMl: 0.1,
      }},
    }, inputs);
    expect(cost.costPending).toBe(false);
    expect(cost.model).toBe('simplified');
    expect(cost.unitCostCents).toBe(393);
    expect(cost.components).toEqual([]);
    expect(cost.estimateLines?.map(line => line.pool)).toEqual(['base','surfactant','fragrance-classic','colorant']);
    expect(input('base',2).stock).toBe(0);
  });

  it('normalizes purchase packaging without changing purchased quantities', () => {
    const packageInput = {
      ...input('base-kg', 0), unitId: 'kg', trackingMode: 'untracked' as const,
      costPool: 'base' as const, costUnitFactor: 1000, costBasisQuantity: 3,
      costBasisValueCents: 6909,
    };
    expect(priceForPool('base', new Map([['base-kg',packageInput]]))).toBeCloseTo(2.303);
  });

  it('refuses to invent a cost when the fragrance group has no price', () => {
    const cost = standardCostForProduct(product, {
      collection: {id:'c',name:'Clássica',active:true,fragranceCostPool:'fragrance-classic'},
      format: {id:'fmt',name:'Floral',active:true,soapCostProfile:{
        baseGrams: 90, surfactantMl: 0, fragranceMl: 2, colorantMl: 0,
      }},
    }, new Map([['base', {...input('base', 2),costPool:'base',active:true}]]));
    expect(cost.costPending).toBe(true);
    expect(cost.missingReferences).toContain('Preço de referência: Grupo de essências da coleção');
    expect(cost.components).toEqual([]);
  });
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

  it('keeps the origin of reusable and product-specific cost contributions', () => {
    const breakdown = productCostBreakdown(product, {
      format: { id: 'fmt', name: 'Barra', active: true, costComponents: [{ inputId: 'extra', unitId: 'ml', quantity: 2 }] },
      fragrance: { id: 'f', name: 'Lavanda', collectionId: 'c', active: true, costComponents: [{ inputId: 'extra', unitId: 'ml', quantity: 3 }] },
    });
    expect(breakdown[0]?.quantity).toBe(6);
    expect(breakdown[0]?.sources.map((item) => item.source)).toEqual(['format', 'fragrance', 'product']);
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

  it('calculates fraction-of-cent material costs from purchases, independent of obsolete physical balance', () => {
    const base = { ...input('base', 2), trackingMode: 'untracked' as const,
      stock: 999, costBasisQuantity: 1000, costBasisValueCents: 2300 };
    expect(inputUnitCostCents(base)).toBe(2.3);
    const result = standardCostForProduct({ ...product, additionalCostCents: 0, recipe: [{ inputId: 'base', unitId: 'g', quantity: 87 }] }, {}, new Map([['base', base]]));
    expect(result.unitCostCents).toBe(200);
    expect(base.stock).toBe(999);
  });

  it('treats legacy tracked inputs as estimated and explicit untracked inputs as untracked', () => {
    expect(trackingModeForInput({})).toBe('estimated');
    expect(trackingModeForInput({ minimumStockConfigured: false })).toBe('untracked');
    expect(trackingModeForInput({ trackingMode: 'exact' })).toBe('exact');
  });
});
