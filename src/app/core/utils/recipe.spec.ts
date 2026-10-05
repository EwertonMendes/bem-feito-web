import { describe, expect, it } from 'vitest';
import { aggregateRecipe } from './recipe';

describe('Production recipe consumption', () => {
  it('aggregates repeated inputs before checking available stock and deducting it', () => {
    expect(aggregateRecipe([
      { inputId: 'base', unitId: 'kg', quantity: 2 },
      { inputId: 'fragrance', unitId: 'ml', quantity: 3 },
      { inputId: 'base', unitId: 'kg', quantity: 4 },
    ])).toEqual([
      { inputId: 'base', unitId: 'kg', quantity: 6 },
      { inputId: 'fragrance', unitId: 'ml', quantity: 3 },
    ]);
  });
  it('rejects conflicting units instead of silently adding incompatible quantities', () => {
    expect(() => aggregateRecipe([
      { inputId: 'base', unitId: 'kg', quantity: 2 },
      { inputId: 'base', unitId: 'g', quantity: 4 },
    ])).toThrow('mesma unidade');
  });
  for (const quantity of [0, -1, NaN, Infinity]) {
    it(`rejects invalid consumption ${quantity}`, () => {
      expect(() => aggregateRecipe([{ inputId: 'base', unitId: 'kg', quantity }])).toThrow('inválida');
    });
  }
});
