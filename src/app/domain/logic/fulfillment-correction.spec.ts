import {describe,it,expect} from 'vitest';
import {validateFulfillmentCorrection} from './fulfillment-correction';
import {saleCorrectionSignature} from './sale-correction';
import {Sale} from '../models/sales.model';
const sale=(stage:Sale['fulfillmentStatus'],applied:boolean):Sale=>({
  id:'sale',code:'V00001',status:'active',businessDate:'2026-10-29',
  fulfillmentStatus:stage,stockApplied:applied,
  items:[],stockEffects:[],orderAllocations:[],paymentIds:[],receivedCents:0,tipCents:0,
  subtotalCents:0,totalCents:0,discountCents:0,balanceCents:0,paymentStatus:'pending'
} as Sale);
describe('safe fulfillment state correction',()=>{
  it('requires physical reconciliation to reverse an already delivered sale',()=>{
    const s=sale('delivered',true),base={expectedSignature:saleCorrectionSignature(s),reason:'Estado incorreto',target:'in-production' as const,physicalStockConfirmed:false};
    expect(()=>validateFulfillmentCorrection(s,base)).toThrow(/fisicamente/);
    expect(()=>validateFulfillmentCorrection(s,{...base,physicalStockConfirmed:true})).not.toThrow();
  });
  it('permits forward correction and rejects stale fingerprints and identical status',()=>{
    const s=sale('in-production',false),base={expectedSignature:saleCorrectionSignature(s),reason:'Já entregue',target:'delivered' as const,physicalStockConfirmed:false};
    expect(()=>validateFulfillmentCorrection(s,base)).not.toThrow();
    expect(()=>validateFulfillmentCorrection(s,{...base,target:'in-production'})).toThrow(/diferente/);
    expect(()=>validateFulfillmentCorrection(s,{...base,expectedSignature:'stale'})).toThrow(/mudou/);
  });
  it('does not rewrite unsafe legacy commitments or contradictory stock state',()=>{
    const s=sale('ready',false);
    expect(()=>validateFulfillmentCorrection({...s,orderAllocations:undefined},{expectedSignature:saleCorrectionSignature({...s,orderAllocations:undefined}),reason:'Correção necessária',target:'delivered',physicalStockConfirmed:false})).toThrow(/histórica/);
    const t={...s,stockApplied:true};
    expect(()=>validateFulfillmentCorrection(t,{expectedSignature:saleCorrectionSignature(t),reason:'Correção necessária',target:'delivered',physicalStockConfirmed:false})).toThrow(/inconsistentes/);
  });
});
