import { describe,expect,it } from 'vitest';
import { allocateDiscounts,buildManagementReport } from './management-report';
import { Sale,Payment } from '../models/sales.model';
import { Expense } from '../models/finance.model';
const base={
  id:'sale',code:'V00001',businessDate:'2026-10-10',customerName:'Cliente',
  status:'active' as const,paymentStatus:'paid' as const,
  paymentIds:[],stockEffects:[],discountCents:1,subtotalCents:300,
  totalCents:299,receivedCents:299,tipCents:0,balanceCents:0,
  createdAt:new Date(),updatedAt:new Date(),createdBy:'x',updatedBy:'x',
};
const items=(values:number[])=>values.map((cents,i)=>({id:String(i),kind:'product' as const,sourceId:'p'+i,
  name:'Soap '+i,collectionId:'c',fragranceId:'f',formatId:'fmt',quantity:1,
  unitPriceCents:cents,unitCostCents:50,totalCents:cents,totalCostCents:50}));
describe('Management report uses exact-cent historical calculations',()=>{
  it('allocates a cent exactly once with deterministic largest remainder',()=>{
    const sale={...base,items:items([100,100,100])} as Sale;
    expect(allocateDiscounts(sale)).toEqual([1,0,0]);
    expect(allocateDiscounts(sale).reduce((a,b)=>a+b,0)).toBe(1);
  });
  it('never confuses payment date, purchases and income',()=>{
    const sale={...base,items:items([100,100,100])} as Sale;
    const payments=[{id:'p',code:'P',saleId:'sale',businessDate:'2026-10-11',methodId:'pix',
      status:'active',amountReceivedCents:340,appliedCents:299,tipCents:41} as Payment];
    const expenses=[
      {id:'e',code:'M',businessDate:'2026-10-11',kind:'input-purchase',amountCents:500} as Expense,
      {id:'eo',code:'M2',businessDate:'2026-10-11',kind:'operating-expense',amountCents:40} as Expense,
    ];
    const report=buildManagementReport([sale],payments,expenses);
    expect(report).toMatchObject({salesCount:1,revenueCents:299,cogsCents:150,
      grossProfitCents:149,receivedCents:299,tipsCents:41,operatingExpensesCents:40,
      inventoryPurchasesCents:500,operationalResultCents:150,unitsSold:3});
    expect(report.byProduct.reduce((total,g)=>total+g.revenueCents,0)).toBe(299);
  });
  it('keeps shipping out of product margin and product grouping',()=>{
    const sale={...base,shippingFeeCents:100,totalCents:399,items:items([100,100,100])} as Sale;
    const report=buildManagementReport([sale],[],[]);
    expect(report).toMatchObject({revenueCents:399,productRevenueCents:299,shippingCents:100,
      grossProfitCents:149,operationalResultCents:249});
    expect(report.byProduct.reduce((sum,item)=>sum+item.revenueCents,0)).toBe(299);
  });
  it('groups historical soap and new candles without retroactively recategorizing sales',()=>{
    const lines=items([100,200]);
    const sale={...base,items:[{...lines[0]!,categoryId:undefined},
      {...lines[1]!,categoryId:'scented-candle' as const}]} as Sale;
    const report=buildManagementReport([sale],[],[]);
    expect(report.byCategory.map(item=>item.label)).toEqual(['Velas Aromáticas','Sabonetes']);
    expect(report.byCategory.reduce((sum,item)=>sum+item.revenueCents,0)).toBe(299);
  });
  it('marks unknown costs explicitly, not as 100% profit',()=>{
    const sale={...base,items:[{...items([300])[0]!,totalCostCents:0}]} as Sale;
    const report=buildManagementReport([sale],[],[]);
    expect(report.missingCostItems).toBe(1);
    expect(report.marginPercent).toBeNull();
    expect(report.byProduct[0]?.marginPercent).toBeNull();
  });
});