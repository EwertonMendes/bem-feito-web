import { describe, expect, it } from 'vitest';
import { inputStockStatus, productStockStatus } from './stock-status';

describe('stock status', () => {
  it('distinguishes negative, low and healthy product stock', () => {
    expect(productStockStatus(-1, 2)).toBe('negative');
    expect(productStockStatus(2, 2)).toBe('low');
    expect(productStockStatus(3, 2)).toBe('ok');
  });

  it('keeps inputs without a configured minimum out of low-stock alerts', () => {
    expect(inputStockStatus(0, 0, false)).toBe('untracked');
    expect(inputStockStatus(-1, 0, false)).toBe('untracked');
    expect(inputStockStatus(-1, 0, true)).toBe('negative');
    expect(inputStockStatus(0, 0, true)).toBe('low');
  });
});
