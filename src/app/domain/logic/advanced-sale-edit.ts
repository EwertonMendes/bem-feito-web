import { Product, Addition, InputItem } from '../models/catalog.model';
import { Sale, SaleLineSnapshot, StockEffect, OrderLineAllocation } from '../models/sales.model';
import { summarizeSaleItems } from './sale-analytics';
import { saleCorrectionSignature } from './sale-correction';
import { inputUnitCostCents, trackingModeForInput } from './costing';

export interface AdvancedSaleLineDraft {
  id:string;
  kind:'product'|'addition';
  sourceId:string;
  quantity:number;
  unitPriceCents:number;
}
export interface AdvancedSaleDraft {
  expectedSignature:string;
  lines:AdvancedSaleLineDraft[];
  discountCents:number;
  reason:string;
  /** Explicit acknowledgement of the physical stock correction on delivered sales. */
  stockReconciliationConfirmed?:boolean;
}
export interface AdvancedSaleCatalog {
  products:ReadonlyMap<string,Product>;
  additions:ReadonlyMap<string,Addition>;
  inputs:ReadonlyMap<string,InputItem>;
}
export interface InventoryDelta {
  itemType:'product'|'input';itemId:string;quantityDelta:number;unitCostCents:number;
  unitCostDeciCents?:number;
}
export interface AdvancedSalePlan {
  items:SaleLineSnapshot[];
  effects:StockEffect[];
  allocations:OrderLineAllocation[]|undefined;
  inventoryDeltas:InventoryDelta[];
  subtotalCents:number;
  totalCents:number;
  balanceCents:number;
  discountCents:number;
  paymentStatus:Sale['paymentStatus'];
  analytics:ReturnType<typeof summarizeSaleItems>;
}

const effectKey=(e:Pick<StockEffect,'itemType'|'itemId'>)=>e.itemType+':'+e.itemId;
const validQty=(value:number)=>Number.isSafeInteger(value)&&value>=1&&value<=100000;
const validCents=(value:number)=>Number.isSafeInteger(value)&&value>=0&&value<=1000000000;
function scaledEffects(line:SaleLineSnapshot,quantity:number):StockEffect[] {
  if(line.stockEffects)return line.stockEffects.map(e=>({...e,quantityDelta:e.quantityDelta*quantity/line.quantity}));
  if(line.kind==='product')return [{itemType:'product',itemId:line.sourceId,quantityDelta:-quantity,
    unitCostCents:line.unitCostCents}];
  if(quantity!==line.quantity)
    throw new Error('Adicional histórico sem consumo individual reconciliado. Não é possível mudar a quantidade.');
  return [];
}
function freshLine(draft:AdvancedSaleLineDraft,catalog:AdvancedSaleCatalog):SaleLineSnapshot{
  if(draft.kind==='product'){
    const product=catalog.products.get(draft.sourceId);
    if(!product||!product.active)throw new Error('O sabonete selecionado não está mais disponível no catálogo.');
    const unitCostCents=product.averageUnitCostCents;
    const unitCostDeciCents=product.unitCostDeciCents??unitCostCents*10;
    return {
      id:draft.id,kind:'product',sourceId:product.id,name:product.displayName,
      ...(product.image?{image:product.image}:{}),
      collectionId:product.collectionId,fragranceId:product.fragranceId,formatId:product.formatId,
      quantity:draft.quantity,unitPriceCents:draft.unitPriceCents,unitCostCents,
      totalCents:draft.unitPriceCents*draft.quantity,
      totalCostCents:Math.round(unitCostDeciCents*draft.quantity/10),
      stockEffects:[{itemType:'product',itemId:product.id,quantityDelta:-draft.quantity,
        unitCostCents,unitCostDeciCents}],
    };
  }
  const addition=catalog.additions.get(draft.sourceId);
  if(!addition||!addition.active)throw new Error('O adicional selecionado não está disponível.');
  const stockEffects:StockEffect[]=[];
  let unitCostCents=0;
  for(const component of addition.components){
    const input=catalog.inputs.get(component.inputId);
    if(!input)throw new Error('O adicional possui um insumo não encontrado.');
    unitCostCents+=component.quantity*inputUnitCostCents(input);
    if(trackingModeForInput(input)!=='untracked')
      stockEffects.push({itemType:'input',itemId:input.id,quantityDelta:-component.quantity*draft.quantity,
        unitCostCents:Math.round(inputUnitCostCents(input))});
  }
  return {
    id:draft.id,kind:'addition',sourceId:addition.id,name:addition.name,
    ...(addition.image?{image:addition.image}:{}),
    quantity:draft.quantity,unitPriceCents:draft.unitPriceCents,
    unitCostCents:Math.round(unitCostCents),
    totalCents:draft.unitPriceCents*draft.quantity,
    totalCostCents:Math.round(unitCostCents*draft.quantity),stockEffects,
  };
}
/**
 * Shared preview/transaction planner. Preserve historical costs on surviving lines;
 * compare per-line material effects only for changed lines.
 */
export function planAdvancedSaleEdit(sale:Sale,draft:AdvancedSaleDraft,catalog:AdvancedSaleCatalog):AdvancedSalePlan{
  if(sale.status!=='active')throw new Error('A venda foi cancelada.');
  if(saleCorrectionSignature(sale)!==draft.expectedSignature)
    throw new Error('A venda mudou desde a abertura. Reabra a edição.');
  if(draft.reason.trim().length<4||draft.reason.trim().length>240)
    throw new Error('Informe o motivo da correção (4 a 240 caracteres).');
  if(!validCents(draft.discountCents))throw new Error('Desconto inválido.');
  if(!draft.lines.length||draft.lines.length>120)throw new Error('A venda deve conter de 1 a 120 linhas.');
  const originalById=new Map(sale.items.map(l=>[l.id,l]));
  const seen=new Set<string>();
  const items:SaleLineSnapshot[]=[];
  const deltas=new Map<string,InventoryDelta>();
  const addEffect=(e:StockEffect,scale:number)=>{
    const key=effectKey(e),old=deltas.get(key);
    deltas.set(key,{itemType:e.itemType,itemId:e.itemId,
      quantityDelta:(old?.quantityDelta??0)+e.quantityDelta*scale,
      unitCostCents:e.unitCostCents, ...(e.unitCostDeciCents===undefined?{}:{unitCostDeciCents:e.unitCostDeciCents})});
  };
  const added:AdvancedSaleLineDraft[]=[];
  for(const entry of draft.lines){
    if(!entry.id||seen.has(entry.id))throw new Error('Existem identificadores de linha repetidos.');
    seen.add(entry.id);
    if(!validQty(entry.quantity)||!validCents(entry.unitPriceCents))
      throw new Error('Quantidade ou preço unitário inválido.');
    const previous=originalById.get(entry.id);
    if(previous&&(previous.kind!==entry.kind||previous.sourceId!==entry.sourceId))
      throw new Error('Para substituir um item, remova a linha antiga e adicione outra.');
    if(!previous){
      added.push(entry);
      const next=freshLine(entry,catalog);
      items.push(next);
      for(const effect of next.stockEffects??[])addEffect(effect,1);
      continue;
    }
    const quantityChanged=previous.quantity!==entry.quantity;
    if(quantityChanged&&sale.stockApplied===false&&!sale.orderAllocations&&previous.kind==='product')
      throw new Error('Pedido legado sem reserva individual: concilie antes de alterar quantidades.');
    if(quantityChanged&&sale.fulfillmentStatus==='ready')
      throw new Error('Reabra a encomenda em produção antes de modificar quantidades já reservadas.');
    const assigned=sale.orderAllocations?.find(a=>a.lineId===entry.id)?.quantity??0;
    if(entry.quantity<assigned)throw new Error('Não é possível reduzir abaixo da quantidade já reservada.');
    if(quantityChanged){
      for(const effect of scaledEffects(previous,previous.quantity))addEffect(effect,-1);
      for(const effect of scaledEffects(previous,entry.quantity))addEffect(effect,1);
    }
    const scaledCost=quantityChanged
      ?Math.round(previous.totalCostCents*entry.quantity/previous.quantity):previous.totalCostCents;
    const effects=quantityChanged?scaledEffects(previous,entry.quantity):previous.stockEffects;
    items.push({...previous,quantity:entry.quantity,unitPriceCents:entry.unitPriceCents,
      totalCents:entry.quantity*entry.unitPriceCents,totalCostCents:scaledCost,
      ...(effects?{stockEffects:effects}:{})});
  }
  for(const previous of sale.items){
    if(seen.has(previous.id))continue;
    const assigned=sale.orderAllocations?.find(a=>a.lineId===previous.id)?.quantity??0;
    if(assigned)throw new Error('Um item reservado não pode ser removido.');
    if(sale.stockApplied===false&&!sale.orderAllocations&&previous.kind==='product')
      throw new Error('Pedido legado: concilie reservas antes de remover sabonetes.');
    if(sale.fulfillmentStatus==='ready')throw new Error('Reabra a encomenda antes de remover itens.');
    if(previous.kind==='addition'&&!previous.stockEffects)
      throw new Error('Adicional antigo sem consumo individual: corrija a origem antes de removê-lo.');
    for(const effect of scaledEffects(previous,previous.quantity))addEffect(effect,-1);
  }
  if(sale.fulfillmentStatus==='ready'&&added.length)
    throw new Error('Reabra a encomenda antes de adicionar itens.');
  const subtotalCents=items.reduce((sum,line)=>sum+line.totalCents,0);
  if(!Number.isSafeInteger(subtotalCents)||draft.discountCents>subtotalCents)
    throw new Error('O desconto não pode ultrapassar a soma dos itens.');
  const totalCents=subtotalCents-draft.discountCents;
  if(sale.receivedCents>totalCents)
    throw new Error('O novo total é menor que os pagamentos recebidos. Regularize o recebimento antes.');
  const balanceCents=totalCents-sale.receivedCents;
  if(balanceCents>0&&!sale.customerName?.trim())throw new Error('Vendas a receber exigem o nome do cliente.');
  const paymentStatus:Sale['paymentStatus']=balanceCents===0?'paid':sale.receivedCents>0?'partial':'pending';
  const merged=new Map<string,StockEffect>();
  for(const original of sale.stockEffects)merged.set(effectKey(original),{...original});
  const inventoryDeltas:InventoryDelta[]=[];
  for(const delta of deltas.values()){
    if(Math.abs(delta.quantityDelta)<1e-8)continue;
    if(!Number.isFinite(delta.quantityDelta))throw new Error('Variação de estoque inválida.');
    inventoryDeltas.push(delta);
    const key=effectKey(delta),original=merged.get(key);
    const remaining=(original?.quantityDelta??0)+delta.quantityDelta;
    if(Math.abs(remaining)<1e-8)merged.delete(key);
    else merged.set(key,{...(original??delta),quantityDelta:remaining});
  }
  const allocations=sale.orderAllocations?[
    ...sale.orderAllocations.filter(a=>items.some(line=>line.id===a.lineId)),
    ...added.filter(l=>l.kind==='product').map(l=>({lineId:l.id,productId:l.sourceId,quantity:0})),
  ]:undefined;
  return {items,effects:[...merged.values()],allocations,inventoryDeltas,subtotalCents,
    totalCents,balanceCents,discountCents:draft.discountCents,paymentStatus,
    analytics:summarizeSaleItems(items)};
}
