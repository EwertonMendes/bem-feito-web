import { describe, expect, it } from 'vitest';
import { soapCostReference, floralReferenceWeight } from './soap-cost-reference';

describe('soap costing presets', () => {
  it('retains confirmed 1 ml of colorant in mini flowers', () => {
    expect(soapCostReference('Mini Florzinhas')?.colorantMl).toBe(1);
  });
  it('uses the Floral midpoint while leaving hearts undefined', () => {
    expect(floralReferenceWeight('Floral')).toBe(77.5);
    expect(soapCostReference('Floral')?.baseGrams).toBe(75);
    expect(soapCostReference('Coraçõezinhos')).toBeNull();
  });
});
