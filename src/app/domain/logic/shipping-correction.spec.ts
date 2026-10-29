import { describe, expect, it } from 'vitest';
import { Sale } from '../models/sales.model';
import { planShippingCorrection, shippingCorrectionSignature } from './shipping-correction';

const sale = {
  id:'k',status:'active',subtotalCents:18000,discountCents:7600,totalCents:10400,
  receivedCents:4700,tipCents:1000,balanceCents:5700,customerName:'Katia',paymentIds:['p1'],
} as Sale;

describe('shipping correction', () => {
  it('reclassifies a delivery charge without creating new cash', () => {
    expect(planShippingCorrection(sale,1000,true)).toMatchObject({
      totalCents:11400,receivedCents:5700,tipCents:0,balanceCents:5700,reclassifiedCents:1000,
    });
  });
  it('increases amount due when there is no reclassification', () => {
    expect(planShippingCorrection(sale,1000,false)).toMatchObject({
      totalCents:11400,receivedCents:4700,tipCents:1000,balanceCents:6700,
    });
  });
  it('rejects unsupported reclassification and invalid fees', () => {
    expect(() => planShippingCorrection(sale,1200,true)).toThrow();
    expect(() => planShippingCorrection(sale,0,true)).toThrow();
    expect(() => planShippingCorrection(sale,-1,false)).toThrow();
  });
  it('fingerprints the expected financial revision', () => {
    expect(shippingCorrectionSignature({...sale,shippingFeeCents:100}))
      .not.toBe(shippingCorrectionSignature(sale));
  });
});
