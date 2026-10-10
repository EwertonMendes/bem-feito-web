import { describe, expect, it } from 'vitest';
import { Addition, InputItem, Kit, Product } from '../models/catalog.model';
import { SaleDraft } from '../models/sales.model';
import { resolveSaleDraft } from './sale-resolution';

const product = (id: string, stock = 10, formatId = 'round'): Product => ({
  id,
  code: id,
  active: true,
  collectionId: 'classic',
  fragranceId: 'lavender',
  formatId,
  displayName: `Produto ${id}`,
  salePriceCents: 1100,
  additionalCostCents: 0,
  averageUnitCostCents: 350,
  stock,
  minimumStock: 0,
  recipe: [],
});

const input = (id: string, stock = 10, trackingMode: InputItem['trackingMode'] = 'exact'): InputItem => ({
  id,
  code: id,
  active: true,
  name: `Insumo ${id}`,
  unitId: 'unit',
  stock,
  minimumStock: 0,
  trackingMode,
  averageUnitCostCents: 200,
});

const emptyDraft = (): SaleDraft => ({
  businessDate: '2026-10-05',
  discountCents: 0,
  lines: [],
  payments: [],
});

describe('sale resolution', () => {
  it('resolves a direct product line and its stock effect', () => {
    const draft = emptyDraft();
    draft.lines = [{ kind: 'product', sourceId: 'p1', quantity: 2 }];
    const resolved = resolveSaleDraft(draft, {
      products: new Map([['p1', product('p1')]]),
      kits: new Map(),
      additions: new Map(),
      inputs: new Map(),
      productUnitCosts: new Map([['p1', 350]]),
    }, () => 'line-1');

    expect(resolved.lines).toEqual([expect.objectContaining({
      id: 'line-1',
      sourceId: 'p1',
      quantity: 2,
      totalCents: 2200,
      totalCostCents: 700,
    })]);
    expect(resolved.stockEffects).toEqual([
      { itemType: 'product', itemId: 'p1', quantityDelta: -2, unitCostCents: 350 },
    ]);
  });

  it('rejects inactive legacy kits while retaining their history in the catalog', () => {
    const kit: Kit = {
      id: 'k1', active: false, name: 'Kit histórico', priceCents: 1900,
      components: [{ id: 'slot', formatId: 'round', quantity: 1, order: 1 }],
    };
    const draft = emptyDraft();
    draft.lines = [{ kind: 'kit', sourceId: 'k1', quantity: 1, componentProductIds: ['p1'] }];
    expect(() => resolveSaleDraft(draft, {
      products: new Map([['p1', product('p1')]]),
      kits: new Map([['k1', kit]]),
      additions: new Map(),
      inputs: new Map(),
      productUnitCosts: new Map(),
    })).toThrow('Este kit está inativo.');
  });

  it('validates kit selections and aggregates product effects', () => {
    const kit: Kit = {
      id: 'k1',
      active: true,
      name: 'Kit',
      priceCents: 1900,
      components: [{ id: 'slot', formatId: 'round', quantity: 2, order: 1 }],
    };
    const draft = emptyDraft();
    draft.lines = [{ kind: 'kit', sourceId: 'k1', quantity: 1, componentProductIds: ['p1', 'p1'] }];

    const resolved = resolveSaleDraft(draft, {
      products: new Map([['p1', product('p1')]]),
      kits: new Map([['k1', kit]]),
      additions: new Map(),
      inputs: new Map(),
      productUnitCosts: new Map([['p1', 350]]),
    }, () => 'line-kit');

    expect(resolved.lines[0]).toEqual(expect.objectContaining({ id: 'line-kit', kind: 'kit', unitCostCents: 700, totalCents: 1900 }));
    expect(resolved.stockEffects).toEqual([
      { itemType: 'product', itemId: 'p1', quantityDelta: -2, unitCostCents: 350 },
    ]);
  });

  it('uses exact stock strictly and estimated stock approximately', () => {
    const addition: Addition = {
      id: 'a1',
      active: true,
      name: 'Embalagem',
      category: 'Embalagem',
      priceCents: 500,
      components: [{ id: 'c1', inputId: 'i1', quantity: 0.5, unitId: 'unit', order: 1 }],
    };
    const draft = emptyDraft();
    draft.lines = [{ kind: 'addition', sourceId: 'a1', quantity: 3 }];

    const exact = resolveSaleDraft(draft, {
      products: new Map(),
      kits: new Map(),
      additions: new Map([['a1', addition]]),
      inputs: new Map([['i1', input('i1', 10, 'exact')]]),
      productUnitCosts: new Map(),
    });
    expect(exact.stockEffects).toEqual([
      { itemType: 'input', itemId: 'i1', quantityDelta: -1.5, unitCostCents: 200 },
    ]);

    const estimated = resolveSaleDraft(draft, {
      products: new Map(),
      kits: new Map(),
      additions: new Map([['a1', addition]]),
      inputs: new Map([['i1', input('i1', 1, 'estimated')]]),
      productUnitCosts: new Map(),
    });
    expect(estimated.lines[0]?.totalCostCents).toBe(300);
    expect(estimated.stockEffects).toEqual([
      { itemType: 'input', itemId: 'i1', quantityDelta: -1, unitCostCents: 200 },
    ]);
  });

  it('does not block an estimated input when theoretical consumption exceeds its balance', () => {
    const addition: Addition = {
      id: 'a2',
      active: true,
      name: 'Estimado',
      category: 'Teste',
      priceCents: 100,
      components: [{ id: 'c2', inputId: 'i2', quantity: 2, unitId: 'unit', order: 1 }],
    };
    const draft = emptyDraft();
    draft.lines = [{ kind: 'addition', sourceId: 'a2', quantity: 2 }];
    const resolved = resolveSaleDraft(draft, {
      products: new Map(),
      kits: new Map(),
      additions: new Map([['a2', addition]]),
      inputs: new Map([['i2', input('i2', 1, 'estimated')]]),
      productUnitCosts: new Map(),
    });
    expect(resolved.stockEffects).toEqual([
      { itemType: 'input', itemId: 'i2', quantityDelta: -1, unitCostCents: 200 },
    ]);
  });

  it('rejects a sale that would make finished-product stock negative', () => {
    const draft = emptyDraft();
    draft.lines = [{ kind: 'product', sourceId: 'p1', quantity: 2 }];
    expect(() => resolveSaleDraft(draft, {
      products: new Map([['p1', product('p1', 1)]]),
      kits: new Map(),
      additions: new Map(),
      inputs: new Map(),
      productUnitCosts: new Map([['p1', 350]]),
    })).toThrow('Estoque insuficiente de Produto p1.');
  });

  it('caps discount at subtotal', () => {
    const draft = emptyDraft();
    draft.discountCents = 5000;
    draft.lines = [{ kind: 'product', sourceId: 'p1', quantity: 1 }];
    const resolved = resolveSaleDraft(draft, {
      products: new Map([['p1', product('p1')]]),
      kits: new Map(),
      additions: new Map(),
      inputs: new Map(),
      productUnitCosts: new Map([['p1', 350]]),
    });
    expect(resolved.subtotalCents).toBe(1100);
    expect(resolved.discountCents).toBe(1100);
    expect(resolved.totalCents).toBe(0);
  });
});
