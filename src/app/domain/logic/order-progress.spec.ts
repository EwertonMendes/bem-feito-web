import { describe, expect, it } from 'vitest';
import { orderProgress, validatedAllocation } from './order-progress';
import { Sale, SaleLineSnapshot } from '../models/sales.model';
const line: SaleLineSnapshot = {id:'l1',kind:'product',sourceId:'p1',name:'Lavanda',quantity:20,unitPriceCents:200,unitCostCents:60,totalCents:4000,totalCostCents:1200};
function sale(extra:Partial<Sale>={}):Sale{return {id:'s1',code:'V001',businessDate:'2026-10-11',discountCents:0,subtotalCents:4000,totalCents:4000,receivedCents:0,tipCents:0,balanceCents:4000,paymentStatus:'pending',status:'active',items:[line],paymentIds:[],stockEffects:[],fulfillmentStatus:'in-production',stockApplied:false,...extra};}
describe('order progress',()=>{
it('does not invent per-order production for legacy records',()=>expect(orderProgress(sale())[0]).toMatchObject({allocated:null,pending:null}));
it('tracks manual order allocation without assuming physical stock belongs to this order',()=>expect(orderProgress(sale({orderAllocations:[{lineId:'l1',productId:'p1',quantity:15}]}))[0]).toMatchObject({allocated:15,pending:5}));
it('considers delivered stock fulfilled',()=>expect(orderProgress(sale({fulfillmentStatus:'delivered',stockApplied:true}))[0]).toMatchObject({allocated:20,pending:0}));
it('rejects over-allocation and invalid fractional units',()=>{
 expect(validatedAllocation(line,15,5)).toBe(20);
 expect(()=>validatedAllocation(line,15,6)).toThrow();
 expect(()=>validatedAllocation(line,0,1.5)).toThrow();
});
});
