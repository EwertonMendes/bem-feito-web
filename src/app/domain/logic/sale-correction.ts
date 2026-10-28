import { calculateSaleTotalCents } from './sale-pricing';
import { Sale, SaleLineSnapshot, StockEffect } from '../models/sales.model';
import { summarizeSaleItems } from './sale-analytics';

export interface SaleProductLineChange {
  lineId: string;
  quantity: number;
  unitPriceCents: number;
}
export interface SaleProductCorrection {
  expectedSignature: string;
  lines: SaleProductLineChange[];
  discountCents: number;
  reason: string;
}
export interface SaleProductCorrectionPlan {
  items: SaleLineSnapshot[];
  effects: StockEffect[];
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  balanceCents: number;
  paymentStatus: Sale['paymentStatus'];
  analytics: ReturnType<typeof summarizeSaleItems>;
  /** Difference in physical stock demand by product, positive means more consumption. */
  demandChange: Map<string, number>;
}
/**
 * Canonical fingerprint of the fields the correction depends on.
 * Firestore may serialize maps with different property insertion order in
 * paginated reads and transactions; object-key order is not a revision.
 * Actual concurrent changes to inventory effects, allocations or payments
 * still invalidate the fingerprint.
 */
export function saleCorrectionSignature(sale: Sale): string {
  const effects = (items: readonly StockEffect[]) => items.map(effect => ({
    itemType: effect.itemType,
    itemId: effect.itemId,
    quantityDelta: effect.quantityDelta,
    unitCostCents: effect.unitCostCents,
    unitCostDeciCents: effect.unitCostDeciCents ?? null,
  })).sort((a,b) =>
    a.itemType.localeCompare(b.itemType) ||
    a.itemId.localeCompare(b.itemId) ||
    a.quantityDelta-b.quantityDelta ||
    a.unitCostCents-b.unitCostCents ||
    (a.unitCostDeciCents??0)-(b.unitCostDeciCents??0));
  const allocations = sale.orderAllocations?.map(item => ({
    lineId: item.lineId, productId: item.productId, quantity: item.quantity,
  })).sort((a,b)=>a.lineId.localeCompare(b.lineId)||a.productId.localeCompare(b.productId)) ?? null;
  return JSON.stringify({
    status: sale.status,
    items: sale.items.map(item=>({
      id: item.id, kind:item.kind, sourceId:item.sourceId,
      quantity:item.quantity, unitPriceCents:item.unitPriceCents,
      unitCostCents:item.unitCostCents,totalCostCents:item.totalCostCents,
      stockEffects:item.stockEffects?effects(item.stockEffects):null,
    })),
    discountCents:sale.discountCents, receivedCents:sale.receivedCents,
    fulfillmentStatus:sale.fulfillmentStatus??'delivered',
    stockApplied:sale.stockApplied!==false,
    orderAllocations:allocations,
    stockEffects:effects(sale.stockEffects),
  });
}

export function planSaleProductCorrection(sale:Sale,draft:SaleProductCorrection):SaleProductCorrectionPlan {
  if(sale.status!=='active')throw new Error('A venda foi cancelada.');
  if(saleCorrectionSignature(sale)!==draft.expectedSignature)
    throw new Error('A venda mudou desde a abertura. Recarregue e confira os valores.');
  if(!Number.isSafeInteger(draft.discountCents)||draft.discountCents<0)
    throw new Error('Desconto inválido.');
  const originals=sale.items.filter(line=>line.kind==='product');
  if(draft.lines.length!==originals.length)throw new Error('O conjunto de sabonetes deve ser preservado nesta correção.');
  const proposals=new Map<string,SaleProductLineChange>();
  for(const item of draft.lines){
    if(proposals.has(item.lineId))throw new Error('Item repetido na correção.');
    if(!Number.isSafeInteger(item.quantity)||item.quantity<0||!Number.isSafeInteger(item.unitPriceCents)||item.unitPriceCents<0)
      throw new Error('Quantidade ou preço unitário inválido.');
    proposals.set(item.lineId,item);
  }
  if(originals.some(line=>!proposals.has(line.id)))throw new Error('Há sabonetes não reconhecidos na correção.');
  const items=sale.items.map(line=>{
    if(line.kind!=='product')return line;
    const proposal=proposals.get(line.id)!;
    if(sale.stockApplied===false && !sale.orderAllocations && proposal.quantity!==line.quantity)
      throw new Error('Pedido legado: é necessário conciliar as reservas antes de alterar quantidades.');
    if(sale.fulfillmentStatus==='ready' && proposal.quantity!==line.quantity)
      throw new Error('Reabra a encomenda em produção antes de modificar quantidades reservadas.');
    const assigned=sale.orderAllocations?.find(x=>x.lineId===line.id)?.quantity??0;
    if(proposal.quantity<assigned)throw new Error('Não é possível reduzir abaixo das unidades já reservadas.');
    return {...line,quantity:proposal.quantity,unitPriceCents:proposal.unitPriceCents,
      totalCents:proposal.quantity*proposal.unitPriceCents,
      totalCostCents:proposal.quantity===line.quantity?line.totalCostCents:
        Math.round(line.totalCostCents*proposal.quantity/line.quantity)};
  }).filter(line=>line.quantity>0);
  if(!items.length)throw new Error('Não é possível deixar a venda sem itens.');
  const subtotalCents=items.reduce((sum,line)=>sum+line.totalCents,0);
  if(draft.discountCents>subtotalCents)throw new Error('Desconto maior que a venda.');
  const totalCents=calculateSaleTotalCents(subtotalCents,draft.discountCents,sale.shippingFeeCents??0);
  if(sale.receivedCents>totalCents)throw new Error('O novo valor é menor que os pagamentos já recebidos. Regularize os recebimentos primeiro.');
  const balanceCents=totalCents-sale.receivedCents;
  if(balanceCents>0&&!sale.customerName?.trim())throw new Error('Informe o cliente antes de manter saldo pendente.');
  const paymentStatus:Sale['paymentStatus']=balanceCents===0?'paid':sale.receivedCents>0?'partial':'pending';
  const oldDemand=new Map<string,number>(),newDemand=new Map<string,number>();
  for(const line of sale.items.filter(x=>x.kind==='product'))oldDemand.set(line.sourceId,(oldDemand.get(line.sourceId)??0)+line.quantity);
  for(const line of items.filter(x=>x.kind==='product'))newDemand.set(line.sourceId,(newDemand.get(line.sourceId)??0)+line.quantity);
  const demandChange=new Map<string,number>();
  for(const id of new Set([...oldDemand.keys(),...newDemand.keys()])){
    const delta=(newDemand.get(id)??0)-(oldDemand.get(id)??0);
    if(delta)demandChange.set(id,delta);
  }
  const effects=sale.stockEffects
    .map(effect=>effect.itemType==='product'?
      {...effect,quantityDelta:-(newDemand.get(effect.itemId)??0)}:effect)
    .filter(effect=>effect.quantityDelta!==0);
  const effectIds=new Set(sale.stockEffects.filter(x=>x.itemType==='product').map(x=>x.itemId));
  if([...newDemand.keys()].some(id=>!effectIds.has(id)))
    throw new Error('Venda sem histórico completo de efeitos do estoque; requer conciliação.');
  return {items,effects,subtotalCents,discountCents:draft.discountCents,totalCents,balanceCents,paymentStatus,
    analytics:summarizeSaleItems(items),demandChange};
}
