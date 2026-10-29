import { Sale } from '../models/sales.model';
import { saleCorrectionSignature } from './sale-correction';

export type FulfillmentStage='in-production'|'ready'|'delivered';
export interface FulfillmentCorrectionDraft {
  expectedSignature:string;
  target:FulfillmentStage;
  reason:string;
  physicalStockConfirmed:boolean;
}
export function currentFulfillmentStage(sale:Sale):FulfillmentStage{
  return sale.fulfillmentStatus??'delivered';
}
export function validateFulfillmentCorrection(sale:Sale,draft:FulfillmentCorrectionDraft):void{
  if(sale.status!=='active')throw new Error('Venda cancelada não pode ter andamento corrigido.');
  if(saleCorrectionSignature(sale)!==draft.expectedSignature)
    throw new Error('A venda mudou desde que a correção foi aberta. Reabra para atualizar.');
  if(draft.reason.trim().length<4||draft.reason.trim().length>240)
    throw new Error('Descreva o motivo da correção (4 a 240 caracteres).');
  const stage=currentFulfillmentStage(sale);
  if(stage===draft.target)throw new Error('Escolha um andamento diferente do atual.');
  if((stage==='delivered')!==(sale.stockApplied!==false))
    throw new Error('Andamento e baixa de estoque inconsistentes. É necessária conciliação.');
  if(stage==='delivered'&&!draft.physicalStockConfirmed)
    throw new Error('Confirme que os itens foram fisicamente devolvidos ao estoque.');
  if(stage!=='delivered'&&!sale.orderAllocations)
    throw new Error('Encomenda histórica sem alocação individual. Concilie antes de corrigir o andamento.');
}
