import { inject, Injectable } from '@angular/core';
import { collection, doc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { AuthService } from '../auth/auth.service';
import { DataRevisionService } from '../firebase/data-revision.service';
import { FIRESTORE } from '../firebase/firebase.providers';
import { todayBusinessDate } from '../utils/date';
import { Product, Addition, InputItem } from '../../domain/models/catalog.model';
import { StockMovement } from '../../domain/models/inventory.model';
import { Sale } from '../../domain/models/sales.model';
import { planAdvancedSaleEdit, AdvancedSaleDraft, AdvancedSaleCatalog } from '../../domain/logic/advanced-sale-edit';
import { productStockStatus, stockStatusForInput } from '../../domain/logic/stock-status';
import { StockChange } from './mutation-results';

@Injectable({providedIn:'root'})
export class AdvancedSaleCorrectionRepository {
  private readonly db=inject(FIRESTORE);
  private readonly auth=inject(AuthService);
  private readonly revisions=inject(DataRevisionService);

  /** Reads the sale and all affected stock documents before writing a single change. */
  async correct(id:string,draft:AdvancedSaleDraft):Promise<{sale:Sale;stockChanges:StockChange[];previousBalanceCents:number}>{
    const userId=this.auth.user()?.uid;
    if(!userId)throw new Error('Sessão inválida.');
    return runTransaction(this.db,async tx=>{
      const saleRef=doc(this.db,'sales',id);
      const snapshot=await tx.get(saleRef);
      if(!snapshot.exists())throw new Error('Venda não encontrada.');
      const current={id:snapshot.id,...snapshot.data()} as Sale;
      if(current.status!=='active')throw new Error('Venda cancelada não pode ser editada.');
      const originals=new Set(current.items.map(item=>item.id));
      const added=draft.lines.filter(item=>!originals.has(item.id));
      const products=new Map<string,Product>();
      const additions=new Map<string,Addition>();
      const inputs=new Map<string,InputItem>();
      for(const productId of new Set(added.filter(item=>item.kind==='product').map(item=>item.sourceId))){
        const ref=doc(this.db,'products',productId),snap=await tx.get(ref);
        if(!snap.exists())throw new Error('Produto não encontrado.');
        products.set(productId,{id:productId,...snap.data()} as Product);
      }
      for(const additionId of new Set(added.filter(item=>item.kind==='addition').map(item=>item.sourceId))){
        const ref=doc(this.db,'additions',additionId),snap=await tx.get(ref);
        if(!snap.exists())throw new Error('Adicional não encontrado.');
        additions.set(additionId,{id:additionId,...snap.data()} as Addition);
      }
      const componentIds=new Set([...additions.values()].flatMap(a=>a.components.map(c=>c.inputId)));
      for(const inputId of componentIds){
        const snap=await tx.get(doc(this.db,'inputs',inputId));
        if(!snap.exists())throw new Error('Insumo do adicional não encontrado.');
        inputs.set(inputId,{id:inputId,...snap.data()} as InputItem);
      }
      const catalog:AdvancedSaleCatalog={products,additions,inputs};
      const plan=planAdvancedSaleEdit(current,draft,catalog);
      if(plan.totalCents===current.totalCents&&plan.discountCents===current.discountCents
        &&JSON.stringify(plan.items)===JSON.stringify(current.items))
        throw new Error('Nenhuma alteração identificada.');
      type Target={ref:ReturnType<typeof doc>;data:Product|InputItem};
      const targets=new Map<string,Target>();
      for(const delta of plan.inventoryDeltas){
        const name=delta.itemType==='product'?'products':'inputs';
        const key=delta.itemType+':'+delta.itemId,ref=doc(this.db,name,delta.itemId);
        const snap=await tx.get(ref);
        if(!snap.exists())throw new Error('Item de estoque não encontrado.');
        targets.set(key,{ref,data:{id:snap.id,...snap.data()} as Product|InputItem});
      }
      // Do not write until every read, allocation check and stock validation is complete.
      const updates:Array<{ref:ReturnType<typeof doc>;data:Record<string,unknown>;change:StockChange;
        movement?:Omit<StockMovement,'id'>}>=[];
      for(const delta of plan.inventoryDeltas){
        const target=targets.get(delta.itemType+':'+delta.itemId)!;
        const entity=target.data;
        const reserved=entity.reservedPhysicalStock??Math.min(entity.stock,entity.committedStock??0);
        const committed=entity.committedStock??0;
        if(current.stockApplied===false){
          const nextCommitted=committed-delta.quantityDelta;
          if(nextCommitted<reserved||nextCommitted<0)
            throw new Error('Esta edição conflita com unidades de outra encomenda.');
          let explicit:Record<string,number>={};
          if(delta.itemType==='product'&&current.orderAllocations){
            const product=entity as Product;
            const nextExplicit=(product.explicitCommittedStock??0)-delta.quantityDelta;
            if(nextExplicit<0||nextExplicit>nextCommitted||(product.explicitAllocatedStock??0)>nextExplicit)
              throw new Error('Esta edição comprometeria unidades já alocadas.');
            explicit={explicitCommittedStock:nextExplicit};
          }
          updates.push({ref:target.ref,data:{committedStock:nextCommitted,...explicit},
            change:{itemType:delta.itemType,itemId:delta.itemId,stock:entity.stock,
              committedStock:nextCommitted,reservedPhysicalStock:reserved}});
        }else{
          const stock=entity.stock+delta.quantityDelta;
          if(stock<0||stock<reserved)
            throw new Error('Estoque livre insuficiente para confirmar esta edição.');
          updates.push({ref:target.ref,
            data:{stock,stockStatus:delta.itemType==='product'
              ?productStockStatus(stock,(entity as Product).minimumStock)
              :stockStatusForInput({...entity as InputItem,stock})},
            change:{itemType:delta.itemType,itemId:delta.itemId,stock,
              committedStock:committed,reservedPhysicalStock:reserved},
            movement:{
              itemType:delta.itemType,itemId:delta.itemId,quantityDelta:delta.quantityDelta,
              unitCostCents:delta.unitCostCents,
              totalCostCents:Math.round(Math.abs(delta.quantityDelta)*(delta.unitCostDeciCents??delta.unitCostCents*10)/10),
              sourceType:'sale-correction',sourceId:id,businessDate:todayBusinessDate(),
              createdAt:serverTimestamp(),updatedAt:serverTimestamp(),createdBy:userId,updatedBy:userId,
            }});
        }
      }
      for(const update of updates){
        tx.update(update.ref,{...update.data,updatedAt:serverTimestamp(),updatedBy:userId});
        if(update.movement)tx.set(doc(collection(this.db,'stockMovements')),update.movement);
      }
      const next:Sale={...current,items:plan.items,stockEffects:plan.effects,
        ...(plan.allocations?{orderAllocations:plan.allocations}:{}),
        productIds:[...new Set(plan.items.filter(x=>x.kind==='product').map(x=>x.sourceId))],
        subtotalCents:plan.subtotalCents,discountCents:plan.discountCents,
        totalCents:plan.totalCents,balanceCents:plan.balanceCents,
        paymentStatus:plan.paymentStatus,...plan.analytics};
      tx.update(saleRef,{items:next.items,stockEffects:next.stockEffects,productIds:next.productIds,
        ...(plan.allocations?{orderAllocations:plan.allocations}:{}),
        subtotalCents:next.subtotalCents,discountCents:next.discountCents,totalCents:next.totalCents,
        balanceCents:next.balanceCents,paymentStatus:next.paymentStatus,...plan.analytics,
        updatedAt:serverTimestamp(),updatedBy:userId});
      tx.set(doc(collection(this.db,'saleCorrections')),{
        saleId:id,kind:'items',businessDate:todayBusinessDate(),
        reason:draft.reason.trim(),
        before:{items:current.items,stockEffects:current.stockEffects,
          subtotalCents:current.subtotalCents,discountCents:current.discountCents,totalCents:current.totalCents},
        after:{items:next.items,stockEffects:next.stockEffects,
          subtotalCents:next.subtotalCents,discountCents:next.discountCents,totalCents:next.totalCents},
        createdAt:serverTimestamp(),updatedAt:serverTimestamp(),createdBy:userId,updatedBy:userId});
      this.revisions.touchTransaction(tx,'sales',...(updates.length?['inventory'] as const:[]));
      return {sale:next,stockChanges:updates.map(x=>x.change),previousBalanceCents:current.balanceCents};
    });
  }
}
