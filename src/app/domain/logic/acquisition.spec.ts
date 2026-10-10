import { describe, expect, it } from 'vitest';
import { landedPurchaseCosts } from './acquisition';

describe('acquisition costs', () => {
  it('allocates shipping in cents and excludes financial interest', () => {
    expect(landedPurchaseCosts([{inputId:'a',unitId:'un',quantity:1,amountCents:1000},{inputId:'b',unitId:'un',quantity:1,amountCents:2000}], [{kind:'shipping',amountCents:101,capitalized:true},{kind:'interest',amountCents:966,capitalized:false}])).toEqual([1033,2068]);
  });
  it('rejects invalid amounts and does not invent stock', () => {
    expect(() => landedPurchaseCosts([{inputId:'a',unitId:'un',quantity:1,amountCents:-1}],[])).toThrow();
  });
});
