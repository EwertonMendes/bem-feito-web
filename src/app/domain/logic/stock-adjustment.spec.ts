import { describe, expect, it } from 'vitest';
import { planStockAdjustment } from './stock-adjustment';

describe('stock adjustment modes', () => {
  it('sets absolute balance, independently of its previous value', () => {
    expect(planStockAdjustment(12, 'set', 100)).toMatchObject({ resultingStock: 100, quantityDelta: 88 });
    expect(planStockAdjustment(12, 'set', 0)).toMatchObject({ resultingStock: 0, quantityDelta: -12 });
  });
  it('changes balance by positive or negative differences', () => {
    expect(planStockAdjustment(12, 'delta', 8)).toMatchObject({ resultingStock: 20, quantityDelta: 8 });
    expect(planStockAdjustment(12, 'delta', -5.25)).toMatchObject({ resultingStock: 6.75, quantityDelta: -5.25 });
  });
  it('clamps a decrease below zero and records only the effective change', () => {
    expect(planStockAdjustment(5, 'delta', -15)).toMatchObject({ resultingStock: 0, quantityDelta: -5, clampedToZero: true });
    expect(planStockAdjustment(0, 'delta', -10)).toMatchObject({ resultingStock: 0, quantityDelta: 0, clampedToZero: true });
  });
  it('rejects negative absolute stock, invalid values and strict legacy negative adjustments', () => {
    expect(() => planStockAdjustment(10, 'set', -1)).toThrow();
    expect(() => planStockAdjustment(10, 'delta', Number.NaN)).toThrow();
    expect(() => planStockAdjustment(10, 'delta', -11, false)).toThrow();
  });
});
