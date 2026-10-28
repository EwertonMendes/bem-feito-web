import { describe, expect, it } from 'vitest';
import { calculateSaleTotalCents } from './sale-pricing';

describe('calculateSaleTotalCents', () => {
  it('preserves old totals without shipping', () => {
    expect(calculateSaleTotalCents(18000, 7600)).toBe(10400);
  });
  it('adds variable shipping after product discounts', () => {
    expect(calculateSaleTotalCents(18000, 7600, 1000)).toBe(11400);
    expect(calculateSaleTotalCents(18000, 7600, 0)).toBe(10400);
  });
  it('rejects invalid inputs', () => {
    expect(() => calculateSaleTotalCents(1000, 0, -100)).toThrow();
    expect(() => calculateSaleTotalCents(1000, 1001)).toThrow();
    expect(() => calculateSaleTotalCents(1000, 0, 1.5)).toThrow();
  });
});
