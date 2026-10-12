import { inject, Injectable } from '@angular/core';
import { collection, deleteField, doc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { Sale } from '../../domain/models/sales.model';
import { Product } from '../../domain/models/catalog.model';
import { StockMovement } from '../../domain/models/inventory.model';
import { planSaleProductCorrection, SaleProductCorrection } from '../../domain/logic/sale-correction';
import { productStockStatus } from '../../domain/logic/stock-status';
import { StockChange } from './mutation-results';
import { AuthService } from '../auth/auth.service';
import { DataRevisionService } from '../firebase/data-revision.service';
import { FIRESTORE } from '../firebase/firebase.providers';
import { isValidBusinessDate, todayBusinessDate } from '../utils/date';
import { normalizeCustomerSearch } from '../utils/customer-search';

export interface SaleMetadataCorrection {
  customerName: string;
  dueDate: string;
  notes: string;
  reason: string;
}

/** Metadata-only corrections never change stock, payments, prices or historical COGS. */
@Injectable({providedIn:'root'})
export class SaleCorrectionRepository {
  private readonly db=inject(FIRESTORE);
  private readonly auth=inject(AuthService);
  private readonly revisions=inject(DataRevisionService);

  async correctMetadata(id:string, draft:SaleMetadataCorrection):Promise<Sale> {
    const userId=this.auth.user()?.uid;
    if(!userId)throw new Error('Sessão inválida.');
    const reason=draft.reason.trim();
    if(reason.length<4 || reason.length>240)throw new Error('Informe o motivo (4 a 240 caracteres).');
    const name=draft.customerName.trim(),date=draft.dueDate.trim(),notes=draft.notes.trim();
    if(name.length>120 || notes.length>500 || (date&&!isValidBusinessDate(date)))
      throw new Error('Confira o nome, a data de vencimento e a observação.');
    return runTransaction(this.db,async tx=>{
      const ref=doc(this.db,'sales',id);
      const snapshot=await tx.get(ref);
      if(!snapshot.exists())throw new Error('Venda não encontrada.');
      const current={id:snapshot.id,...snapshot.data()} as Sale;
      if(current.status!=='active')throw new Error('Uma venda cancelada não pode ser corrigida.');
      if((current.balanceCents>0 || current.stockApplied===false) && !name)
        throw new Error('Esta venda precisa manter o nome do cliente.');
      const before={customerName:current.customerName??'',dueDate:current.dueDate??'',notes:current.notes??''};
      const after={customerName:name,dueDate:date,notes};
      if(Object.keys(before).every(key=>before[key as keyof typeof before]===after[key as keyof typeof after]))
        throw new Error('Nenhuma alteração identificada.');
      tx.update(ref,{
        customerName:name||deleteField(),
        customerSearchKey:name?normalizeCustomerSearch(name):deleteField(),
        dueDate:date||deleteField(),notes:notes||deleteField(),
        updatedAt:serverTimestamp(),updatedBy:userId,
      });
      const auditRef=doc(collection(this.db,'saleCorrections'));
      tx.set(auditRef,{saleId:id,businessDate:todayBusinessDate(),reason,before,after,
        createdAt:serverTimestamp(),updatedAt:serverTimestamp(),
        createdBy:userId,updatedBy:userId});
      this.revisions.touchTransaction(tx,'sales');
      return {...current,customerName:name||undefined,customerSearchKey:name?normalizeCustomerSearch(name):undefined,
        dueDate:date||undefined,notes:notes||undefined};
    });
  }
  /** Atomic quantity/price corrections for existing soaps; additions remain unchanged. */
  async correctProductLines(id:string,draft:SaleProductCorrection):
    Promise<{sale:Sale;stockChanges:StockChange[];previousBalanceCents:number}> {
    const userId=this.auth.user()?.uid;
    if(!userId)throw new Error('Sessão inválida.');
    const reason=draft.reason.trim();
    if(reason.length<4||reason.length>240)throw new Error('Informe o motivo da correção (4 a 240 caracteres).');
    return runTransaction(this.db,async tx=>{
      const saleRef=doc(this.db,'sales',id);
      const snap=await tx.get(saleRef);
      if(!snap.exists())throw new Error('Venda não encontrada.');
      const current={id:snap.id,...snap.data()} as Sale;
      const plan=planSaleProductCorrection(current,draft);
      if(!plan.demandChange.size && plan.totalCents===current.totalCents &&
        JSON.stringify(plan.items)===JSON.stringify(current.items) && plan.discountCents===current.discountCents)
        throw new Error('Nenhuma alteração identificada.');
      const productDocs=new Map<string,{ref:ReturnType<typeof doc>;data:Product}>();
      for(const productId of plan.demandChange.keys()){
        const ref=doc(this.db,'products',productId);
        const productSnap=await tx.get(ref);
        if(!productSnap.exists())throw new Error('Sabonete da venda não encontrado no estoque.');
        productDocs.set(productId,{ref,data:{id:productId,...productSnap.data()} as Product});
      }
      const stockChanges:StockChange[]=[];
      for(const [productId,demandDelta] of plan.demandChange){
        const record=productDocs.get(productId)!;
        const product=record.data;
        const committed=product.committedStock??0;
        const reserved=product.reservedPhysicalStock??Math.min(product.stock,committed);
        if(current.stockApplied===false){
          const nextCommitted=committed+demandDelta;
          if(nextCommitted<0||reserved>nextCommitted)
            throw new Error('A correção entraria em conflito com unidades já reservadas.');
          tx.update(record.ref,{committedStock:nextCommitted,updatedAt:serverTimestamp(),updatedBy:userId});
          stockChanges.push({itemType:'product',itemId:productId,stock:product.stock,
            committedStock:nextCommitted,reservedPhysicalStock:reserved});
        }else{
          const nextStock=product.stock-demandDelta;
          if(nextStock<0||nextStock<reserved)
            throw new Error('Estoque livre insuficiente para corrigir esta venda.');
          tx.update(record.ref,{stock:nextStock,stockStatus:productStockStatus(nextStock,product.minimumStock),
            updatedAt:serverTimestamp(),updatedBy:userId});
          stockChanges.push({itemType:'product',itemId:productId,stock:nextStock,
            committedStock:committed,reservedPhysicalStock:reserved});
          const originalEffect=current.stockEffects.find(x=>x.itemType==='product'&&x.itemId===productId);
          if(!originalEffect)throw new Error('Histórico de estoque incompleto.');
          const stockMovement=doc(collection(this.db,'stockMovements'));
          tx.set(stockMovement,{
            itemType:'product',itemId:productId,quantityDelta:-demandDelta,
            unitCostCents:originalEffect.unitCostCents,
            totalCostCents:Math.round(Math.abs(demandDelta)*
              (originalEffect.unitCostDeciCents??originalEffect.unitCostCents*10)/10),
            sourceType:'sale-correction',sourceId:id,businessDate:todayBusinessDate(),
            createdAt:serverTimestamp(),updatedAt:serverTimestamp(),
            createdBy:userId,updatedBy:userId,
          } satisfies Omit<StockMovement,'id'>);
        }
      }
      const allocations=current.orderAllocations?.filter(a=>plan.items.some(item=>item.id===a.lineId));
      const next:Sale={...current,items:plan.items,stockEffects:plan.effects,
        subtotalCents:plan.subtotalCents,discountCents:plan.discountCents,
        totalCents:plan.totalCents,balanceCents:plan.balanceCents,paymentStatus:plan.paymentStatus,
        ...(allocations?{orderAllocations:allocations}:{}),...plan.analytics};
      tx.update(saleRef,{
        items:next.items,stockEffects:next.stockEffects,
        subtotalCents:next.subtotalCents,discountCents:next.discountCents,
        totalCents:next.totalCents,balanceCents:next.balanceCents,paymentStatus:next.paymentStatus,
        ...(allocations?{orderAllocations:allocations}:{}),...plan.analytics,
        updatedAt:serverTimestamp(),updatedBy:userId,
      });
      const auditRef=doc(collection(this.db,'saleCorrections'));
      tx.set(auditRef,{
        saleId:id,kind:'items',businessDate:todayBusinessDate(),reason,
        before:{items:current.items,stockEffects:current.stockEffects,
          subtotalCents:current.subtotalCents,discountCents:current.discountCents,totalCents:current.totalCents},
        after:{items:next.items,stockEffects:next.stockEffects,
          subtotalCents:next.subtotalCents,discountCents:next.discountCents,totalCents:next.totalCents},
        createdAt:serverTimestamp(),updatedAt:serverTimestamp(),
        createdBy:userId,updatedBy:userId,
      });
      this.revisions.touchTransaction(tx,'sales',...(plan.demandChange.size?['inventory'] as const:[]));
      return {sale:next,stockChanges,previousBalanceCents:current.balanceCents};
    });
  }

}
