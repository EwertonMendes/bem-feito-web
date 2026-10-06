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

const input = (id: string, stock = 10): InputItem => ({
  id,
  code: id,
  active: true,
  name: `Insumo ${id}`,
  unitId: 'unit',
  stock,
  minimumStock: 0,
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
    expect(resolved.totalCents).toBe(2200);
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
    }, () => 'line-kit');

    expect(resolved.lines[0]).toEqual(expect.objectContaining({
      id: 'line-kit',
      kind: 'kit',
      unitCostCents: 700,
      totalCents: 1900,
    }));
    expect(resolved.stockEffects).toEqual([
      { itemType: 'product', itemId: 'p1', quantityDelta: -2, unitCostCents: 350 },
    ]);
  });

  it('resolves addition cost and input consumption', () => {
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

    const resolved = resolveSaleDraft(draft, {
      products: new Map(),
      kits: new Map(),
      additions: new Map([['a1', addition]]),
      inputs: new Map([['i1', input('i1')]]),
    }, () => 'line-addition');

    expect(resolved.lines[0]).toEqual(expect.objectContaining({
      unitCostCents: 100,
      totalCostCents: 300,
      totalCents: 1500,
    }));
    expect(resolved.stockEffects).toEqual([
      { itemType: 'input', itemId: 'i1', quantityDelta: -1.5, unitCostCents: 200 },
    ]);
  });

  it('rejects a sale that would make stock negative', () => {
    const draft = emptyDraft();
    draft.lines = [{ kind: 'product', sourceId: 'p1', quantity: 2 }];

    expect(() => resolveSaleDraft(draft, {
      products: new Map([['p1', product('p1', 1)]]),
      kits: new Map(),
      additions: new Map(),
      inputs: new Map(),
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
    });

    expect(resolved.subtotalCents).toBe(1100);
    expect(resolved.discountCents).toBe(1100);
    expect(resolved.totalCents).toBe(0);
  });
});
