import { describe, expect, it } from 'vitest';
import { Sale } from '../models/sales.model';
import { planSaleProductCorrection, saleCorrectionSignature } from './sale-correction';
const base:Sale={
  id:'sale-1',code:'V00001',businessDate:'2026-10-11',customerName:'Cliente',
  subtotalCents:2000,discountCents:0,totalCents:2000,receivedCents:500,tipCents:0,
  balanceCents:1500,paymentStatus:'partial',status:'active',paymentIds:[],
  items:[{id:'line-1',kind:'product',sourceId:'soap-1',name:'Sabonete',
    quantity:2,unitPriceCents:1000,totalCents:2000,unitCostCents:200,totalCostCents:400}],
  stockEffects:[{itemType:'product',itemId:'soap-1',quantityDelta:-2,unitCostCents:200}],
  stockApplied:true,fulfillmentStatus:'delivered',
};
function draft(quantity:number,price=1000,discount=0){
  return {expectedSignature:saleCorrectionSignature(base),lines:[{lineId:'line-1',quantity,unitPriceCents:price}],
    discountCents:discount,reason:'Corrigir itens'};
}
describe('sale corrections',()=>{
  it('preserves original cost rate and calculates only the necessary stock delta',()=>{
    const p=planSaleProductCorrection(base,draft(3,900,100));
    expect(p.totalCents).toBe(2600);
    expect(p.items[0]).toMatchObject({quantity:3,unitPriceCents:900,totalCostCents:600});
    expect(p.effects[0]).toMatchObject({quantityDelta:-3});
    expect(p.demandChange.get('soap-1')).toBe(1);
    expect(p.balanceCents).toBe(2100);
  });
  it('rejects a paid amount larger than the corrected order',()=>{
    expect(()=>planSaleProductCorrection(base,draft(1,100))).toThrow('pagamentos');
  });
  it('rejects stale revisions',()=>{
    expect(()=>planSaleProductCorrection(base,{...draft(3),expectedSignature:'outdated'})).toThrow('mudou');
  });
  it('cannot decrease below physically allocated order units',()=>{
    const current={...base,stockApplied:false,fulfillmentStatus:'in-production' as const,
      orderAllocations:[{lineId:'line-1',productId:'soap-1',quantity:2}]};
    expect(()=>planSaleProductCorrection(current,{...draft(1),
      expectedSignature:saleCorrectionSignature(current)})).toThrow('reservadas');
  });
  it('does not mutate the original sale object',()=>{
    const p=planSaleProductCorrection(base,draft(4));
    expect(base.items[0].quantity).toBe(2);
    expect(p.items[0].quantity).toBe(4);
  });
});
