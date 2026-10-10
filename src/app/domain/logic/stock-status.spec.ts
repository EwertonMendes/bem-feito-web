import { describe, expect, it } from 'vitest';
import { inputStockStatus, productStockStatus } from './stock-status';

describe('stock status', () => {
  it('distinguishes negative, low and healthy product stock', () => {
    expect(productStockStatus(-1, 2)).toBe('negative');
    expect(productStockStatus(2, 2)).toBe('low');
    expect(productStockStatus(3, 2)).toBe('ok');
  });

  it('keeps explicitly untracked inputs out of stock alerts', () => {
    expect(inputStockStatus(0, 0, true, 'untracked')).toBe('untracked');
    expect(inputStockStatus(-1, 0, true, 'untracked')).toBe('untracked');
  });

  it('keeps legacy minimum-disabled inputs compatible as untracked', () => {
    expect(inputStockStatus(0, 0, false)).toBe('untracked');
  });

  it('alerts both exact and estimated inputs when their balance is low', () => {
    expect(inputStockStatus(0, 0, true, 'exact')).toBe('low');
    expect(inputStockStatus(0, 0, true, 'estimated')).toBe('low');
    expect(inputStockStatus(2, 0, true, 'estimated')).toBe('ok');
  });
});
