import { describe, expect, it } from 'vitest';
import { planAdvancedSaleEdit, type AdvancedSaleCatalog } from './advanced-sale-edit';
import { saleCorrectionSignature } from './sale-correction';
import { Sale } from '../models/sales.model';
import { Product, Addition, InputItem } from '../models/catalog.model';
const product=(id:string):Product=>({id,code:id,active:true,collectionId:'c',fragranceId:'f',formatId:'fmt',
  displayName:id,salePriceCents:1000,additionalCostCents:0,averageUnitCostCents:300,
  stock:10,minimumStock:0,recipe:[]});
const input:InputItem={id:'i',code:'i',active:true,name:'Envelope',unitId:'u',stock:10,
  minimumStock:0,trackingMode:'exact',averageUnitCostCents:50};
const addition: Addition={id:'a',active:true,name:'Presente',category:'Embalagem',priceCents:200,
  components:[{id:'c',inputId:'i',unitId:'u',quantity:2,order:1}]};
const catalog:AdvancedSaleCatalog={products:new Map([['p2',product('p2')]]),
  additions:new Map([['a',addition]]),inputs:new Map([['i',input]])};
const sale=(options:Partial<Sale>={}):Sale=>({
  id:'s',code:'V00001',businessDate:'2026-10-11',customerName:'Teste',status:'active',
  paymentStatus:'pending',stockApplied:true,fulfillmentStatus:'delivered',
  items:[{id:'old',kind:'product',sourceId:'p',name:'P',quantity:2,unitPriceCents:1000,
    unitCostCents:250,totalCents:2000,totalCostCents:500}],
  stockEffects:[{itemType:'product',itemId:'p',quantityDelta:-2,unitCostCents:250}],
  paymentIds:[],discountCents:0,subtotalCents:2000,totalCents:2000,
  receivedCents:0,tipCents:0,balanceCents:2000,
  createdAt:new Date(),updatedAt:new Date(),createdBy:'operator',updatedBy:'operator',...options
});
const change=(s:Sale,lines:Array<{id:string;kind:'product'|'addition';sourceId:string;quantity:number;unitPriceCents:number}>,discountCents=0)=>({
  expectedSignature:saleCorrectionSignature(s),lines,discountCents,reason:'Revisão de itens',
});
describe('Advanced sale correction domain integrity',()=>{
  it('changes a delivered soap to another without replacing historical cost snapshots',()=>{
    const original=sale();
    const next=planAdvancedSaleEdit(original,change(original,[
      {id:'new',kind:'product',sourceId:'p2',quantity:1,unitPriceCents:1100},
    ]),catalog);
    expect(next.inventoryDeltas.map(d=>[d.itemId,d.quantityDelta]).sort()).toEqual([['p',2],['p2',-1]]);
    expect(next.items[0]).toMatchObject({id:'new',sourceId:'p2',totalCostCents:300});
    expect(next.totalCents).toBe(1100);
    expect(original.stockEffects).toEqual([{itemType:'product',itemId:'p',quantityDelta:-2,unitCostCents:250}]);
  });
  it('preserves old unit costs when quantities and prices change',()=>{
    const original=sale(),next=planAdvancedSaleEdit(original,change(original,[{
      id:'old',kind:'product',sourceId:'p',quantity:3,unitPriceCents:900,
    }],100),catalog);
    expect(next.items[0]).toMatchObject({unitCostCents:250,totalCostCents:750,totalCents:2700});
    expect(next.totalCents).toBe(2600);
    expect(next.inventoryDeltas).toMatchObject([{itemId:'p',quantityDelta:-1}]);
  });
  it('allocates input stock for newly added additions without consuming product stock twice',()=>{
    const original=sale(),next=planAdvancedSaleEdit(original,change(original,[
      {id:'old',kind:'product',sourceId:'p',quantity:2,unitPriceCents:1000},
      {id:'gift',kind:'addition',sourceId:'a',quantity:2,unitPriceCents:200},
    ]),catalog);
    expect(next.inventoryDeltas).toMatchObject([{itemType:'input',itemId:'i',quantityDelta:-4}]);
    expect(next.items[1]).toMatchObject({kind:'addition',totalCostCents:200});
    expect(next.totalCents).toBe(2400);
  });
  it('does not fabricate material consumption for historical additions',()=>{
    const original=sale({items:[{id:'old',kind:'addition',sourceId:'a',name:'Presente',
      quantity:1,unitPriceCents:200,unitCostCents:100,totalCents:200,totalCostCents:100}],
      stockEffects:[{itemType:'input',itemId:'i',quantityDelta:-2,unitCostCents:50}],
      subtotalCents:200,totalCents:200,balanceCents:200});
    expect(()=>planAdvancedSaleEdit(original,change(original,[]),catalog)).toThrow();
    expect(()=>planAdvancedSaleEdit(original,change(original,[{
      id:'old',kind:'addition',sourceId:'a',quantity:2,unitPriceCents:200,
    }]),catalog)).toThrow('consumo individual');
  });
  it('protects money already received and reserved stock',()=>{
    const paid=sale({receivedCents:1800,balanceCents:200,paymentStatus:'partial'});
    expect(()=>planAdvancedSaleEdit(paid,change(paid,[{id:'old',kind:'product',sourceId:'p',
      quantity:1,unitPriceCents:1000}]),catalog)).toThrow('pagamentos recebidos');
    const ordered=sale({stockApplied:false,fulfillmentStatus:'in-production',
      orderAllocations:[{lineId:'old',productId:'p',quantity:2}]});
    expect(()=>planAdvancedSaleEdit(ordered,change(ordered,[{id:'old',kind:'product',
      sourceId:'p',quantity:1,unitPriceCents:1000}]),catalog)).toThrow('reservada');
  });
});