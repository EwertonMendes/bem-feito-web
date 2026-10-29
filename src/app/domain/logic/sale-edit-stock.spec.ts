import {describe,it,expect} from 'vitest';
import { canIncreaseSaleProduct, maxSaleLineQuantity, saleProductMaximum } from './sale-edit-stock';
import { Product } from '../models/catalog.model';
import { SaleLineSnapshot } from '../models/sales.model';
import { AdvancedSaleLineDraft } from './advanced-sale-edit';
const product=(stock:number,reservedPhysicalStock=0)=>({id:'p',stock,reservedPhysicalStock,committedStock:reservedPhysicalStock}) as Product;
const prior=(quantity:number)=>[{kind:'product',sourceId:'p',quantity,id:'old'}] as SaleLineSnapshot[];
const draft=(quantity:number):AdvancedSaleLineDraft[]=>[{kind:'product',sourceId:'p',quantity,id:'old',unitPriceCents:200}];
describe('stock limits for sale corrections',()=>{
  it('does not offer an unavailable product',()=>{expect(saleProductMaximum(product(0),[])).toBe(0);expect(canIncreaseSaleProduct(product(0),[],[])).toBe(false);});
  it('adds only unreserved physical quantities to historic sold units',()=>{
    expect(saleProductMaximum(product(8,5),prior(4))).toBe(7);
    expect(canIncreaseSaleProduct(product(8,5),prior(4),draft(6))).toBe(true);
    expect(canIncreaseSaleProduct(product(8,5),prior(4),draft(7))).toBe(false);
  });
  it('restores capacity when editing down and does not double count separate lines',()=>{
    const lines=[...draft(2),{kind:'product' as const,sourceId:'p',quantity:3,id:'new',unitPriceCents:200}];
    expect(maxSaleLineQuantity(product(3),prior(4),lines,lines[0]!)).toBe(4);
    expect(canIncreaseSaleProduct(product(3),prior(4),lines)).toBe(true);
  });
  it('blocks increasing an already historically overcommitted item',()=>{
    expect(canIncreaseSaleProduct(product(0),prior(10),draft(10))).toBe(false);
  });
});
