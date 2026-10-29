import { Product } from '../models/catalog.model';
import { SaleLineSnapshot } from '../models/sales.model';
import { AdvancedSaleLineDraft } from './advanced-sale-edit';

export function physicalFreeStock(product: Pick<Product,'stock'|'reservedPhysicalStock'|'committedStock'>):number {
  return Math.max(0, product.stock-(product.reservedPhysicalStock??Math.min(product.stock,product.committedStock??0)));
}

export function saleProductQuantity(lines:readonly Pick<AdvancedSaleLineDraft,'kind'|'sourceId'|'quantity'>[],productId:string):number {
  return lines.reduce((sum,line)=>sum+(line.kind==='product'&&line.sourceId===productId?line.quantity:0),0);
}

/**
 * Existing sold/committed quantities belong to this sale, not free stock.
 * A correction can preserve those units, restore them or consume additional
 * units only from stock not allocated to other orders.
 */
export function saleProductMaximum(product:Product,baseline:readonly SaleLineSnapshot[]):number {
  return saleProductQuantity(baseline,product.id)+physicalFreeStock(product);
}
export function canIncreaseSaleProduct(product:Product,baseline:readonly SaleLineSnapshot[],
  lines:readonly AdvancedSaleLineDraft[]):boolean{
  return saleProductQuantity(lines,product.id)<saleProductMaximum(product,baseline);
}
export function maxSaleLineQuantity(product:Product,baseline:readonly SaleLineSnapshot[],
  lines:readonly AdvancedSaleLineDraft[],line:AdvancedSaleLineDraft):number{
  const others=saleProductQuantity(lines.filter(x=>x.id!==line.id),product.id);
  return Math.max(0,saleProductMaximum(product,baseline)-others);
}
