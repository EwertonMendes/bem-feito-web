import {inject,Injectable} from '@angular/core';
import {collection,doc,runTransaction,serverTimestamp} from 'firebase/firestore';
import {AuthService} from '../auth/auth.service';
import {DataRevisionService} from '../firebase/data-revision.service';
import {FIRESTORE} from '../firebase/firebase.providers';
import {todayBusinessDate} from '../utils/date';
import {Product,InputItem} from '../../domain/models/catalog.model';
import {StockMovement} from '../../domain/models/inventory.model';
import {Sale,OrderLineAllocation,StockEffect} from '../../domain/models/sales.model';
import {currentFulfillmentStage, FulfillmentCorrectionDraft,validateFulfillmentCorrection} from '../../domain/logic/fulfillment-correction';
import {trackingModeForInput} from '../../domain/logic/costing';
import {productStockStatus} from '../../domain/logic/stock-status';
import {StockChange} from './mutation-results';

@Injectable({providedIn:'root'})
export class FulfillmentCorrectionRepository {
  private readonly db=inject(FIRESTORE);
  private readonly auth=inject(AuthService);
  private readonly revisions=inject(DataRevisionService);

  /**
   * Corrections of workflow state are atomic, audited and never change payment data.
   * Physical stock and commitment counters are updated together. The original
   * sale is re-read within the transaction to reject stale edits.
   */
  async correct(id:string,draft:FulfillmentCorrectionDraft):
    Promise<{sale:Sale;stockChanges:StockChange[]}> {
    const userId=this.auth.user()?.uid;
    if(!userId)throw new Error('Sessão inválida.');
    return runTransaction(this.db,async tx=>{
      const saleRef=doc(this.db,'sales',id);
      const snapshot=await tx.get(saleRef);
      if(!snapshot.exists())throw new Error('Venda não encontrada.');
      const sale={id:snapshot.id,...snapshot.data()} as Sale;
      validateFulfillmentCorrection(sale,draft);
      const oldStage=currentFulfillmentStage(sale);
      const oldOpen=oldStage!=='delivered',newOpen=draft.target!=='delivered';
      const oldAllocations=sale.orderAllocations??[];
      const oldAllocated=new Map<string,number>();
      for(const allocation of oldAllocations){
        if(!Number.isSafeInteger(allocation.quantity)||allocation.quantity<0)
          throw new Error('Alocação histórica inválida.');
        oldAllocated.set(allocation.productId,(oldAllocated.get(allocation.productId)??0)+allocation.quantity);
      }
      const productLines=sale.items.filter(item=>item.kind==='product');
      const linesById=new Map(productLines.map(line=>[line.id,line]));
      for(const allocation of oldAllocations){
        const line=linesById.get(allocation.lineId);
        if(!line||line.sourceId!==allocation.productId||allocation.quantity>line.quantity)
          throw new Error('A reserva individual não corresponde aos itens da venda.');
      }
      for(const line of productLines){
        if(!Number.isSafeInteger(line.quantity)||line.quantity<=0)
          throw new Error('Quantidade histórica inválida.');
        if(oldOpen && !oldAllocations.some(a=>a.lineId===line.id&&a.productId===line.sourceId))
          throw new Error('Alocação de encomenda ausente; concilie antes da correção.');
      }
      if(oldStage==='ready'){
        for(const line of productLines){
          const allocated=oldAllocations.find(a=>a.lineId===line.id)?.quantity??0;
          if(allocated!==line.quantity)throw new Error('Encomenda pronta com reserva incompleta. Concilie antes de editar.');
        }
      }
      const nextAllocations:OrderLineAllocation[]=newOpen
        ?productLines.map(line=>({lineId:line.id,productId:line.sourceId,
          quantity:draft.target==='ready'?line.quantity:0}))
        :oldAllocations;
      const nextAllocated=new Map<string,number>();
      if(newOpen && draft.target==='ready'){
        for(const a of nextAllocations)nextAllocated.set(a.productId,(nextAllocated.get(a.productId)??0)+a.quantity);
      }
      const effects=new Map<string,StockEffect>();
      for(const effect of sale.stockEffects){
        const key=effect.itemType+':'+effect.itemId;
        if(effects.has(key))throw new Error('Efeitos de estoque históricos duplicados; requer conciliação.');
        if(!Number.isFinite(effect.quantityDelta)||effect.quantityDelta>=0)
          throw new Error('Efeito de estoque histórico inválido.');
        effects.set(key,effect);
      }
      const productQty=new Map<string,number>();
      for(const line of productLines)productQty.set(line.sourceId,(productQty.get(line.sourceId)??0)+line.quantity);
      for(const effect of effects.values()){
        if(effect.itemType==='product'&&!productQty.has(effect.itemId))
          throw new Error('Há produto no histórico de estoque sem linha de venda. Concilie antes de corrigir.');
      }
      for(const [id,qty] of productQty){
        const effect=effects.get('product:'+id);
        if(!effect||-effect.quantityDelta!==qty)
          throw new Error('Quantidade e histórico de estoque divergem. Concilie antes de corrigir.');
      }
      type Target={ref:ReturnType<typeof doc>;data:Product|InputItem;effect:StockEffect};
      const targets:Target[]=[];
      for(const effect of effects.values()){
        const path=effect.itemType==='product'?'products':'inputs';
        const targetRef=doc(this.db,path,effect.itemId);
        const snap=await tx.get(targetRef);
        if(!snap.exists())throw new Error('Item do estoque não encontrado.');
        const data={id:snap.id,...snap.data()} as Product|InputItem;
        if(effect.itemType==='input'){
          // Inputs have no line-level reservation provenance. Avoid changing or
          // consuming another order's material. Untracked inputs need no movement.
          if(trackingModeForInput(data as InputItem)!=='untracked')
            throw new Error('Esta encomenda contém adicionais com insumos rastreados. Concilie-os antes de mudar o andamento.');
          continue;
        }
        targets.push({ref:targetRef,data,effect});
      }
      const changes:StockChange[]=[];
      const writes:Array<{ref:ReturnType<typeof doc>;values:Record<string,number>;effect:StockEffect;stockDelta:number}>=[];
      for(const target of targets){
        const product=target.data as Product;
        const required=-target.effect.quantityDelta;
        const physical=product.stock;
        const committed=product.committedStock??0;
        const reserved=product.reservedPhysicalStock??Math.min(physical,committed);
        const explicitCommitted=product.explicitCommittedStock??0;
        const explicitAllocated=product.explicitAllocatedStock??0;
        const assignedBefore=oldOpen?(oldAllocated.get(product.id)??0):0;
        const assignedAfter=newOpen?(nextAllocated.get(product.id)??0):0;
        if(assignedBefore>required||assignedAfter>required||reserved<assignedBefore)
          throw new Error('Reserva da encomenda inconsistente. Concilie o estoque.');
        const committedDelta=(newOpen?required:0)-(oldOpen?required:0);
        const allocationDelta=assignedAfter-assignedBefore;
        const stockDelta=(oldStage==='delivered'?required:0)-(draft.target==='delivered'?required:0);
        const nextStock=physical+stockDelta;
        const nextCommitted=committed+committedDelta;
        const nextReserved=reserved+allocationDelta;
        const nextExplicitCommitted=explicitCommitted+committedDelta;
        const nextExplicitAllocated=explicitAllocated+allocationDelta;
        if([nextStock,nextCommitted,nextReserved,nextExplicitCommitted,nextExplicitAllocated].some(n=>!Number.isSafeInteger(n)||n<0)
          ||nextReserved>nextStock ||nextExplicitAllocated>nextExplicitCommitted ||
          nextExplicitCommitted>nextCommitted)
          throw new Error('Estoque insuficiente ou compromissos incompatíveis com o andamento solicitado.');
        // A delivery can use its own physical allocations plus stock truly free
        // of commitments belonging to other orders.
        if(stockDelta<0 && physical-reserved<required-assignedBefore)
          throw new Error('Estoque livre insuficiente para registrar a entrega.');
        writes.push({ref:target.ref,values:{
          stock:nextStock,committedStock:nextCommitted,reservedPhysicalStock:nextReserved,
          explicitCommittedStock:nextExplicitCommitted,explicitAllocatedStock:nextExplicitAllocated,
        },effect:target.effect,stockDelta});
        changes.push({itemType:'product',itemId:product.id,stock:nextStock,
          committedStock:nextCommitted,reservedPhysicalStock:nextReserved});
      }
      for(let i=0;i<writes.length;i++){
        const write=writes[i]!;
        const product=targets[i]!.data as Product;
        tx.update(write.ref,{...write.values,stockStatus:productStockStatus(write.values.stock!,product.minimumStock),
          updatedAt:serverTimestamp(),updatedBy:userId});
        if(write.stockDelta!==0){
          const movement:Omit<StockMovement,'id'>={
            itemType:'product',itemId:write.effect.itemId,quantityDelta:write.stockDelta,
            unitCostCents:write.effect.unitCostCents,
            totalCostCents:Math.round(Math.abs(write.stockDelta)*(write.effect.unitCostDeciCents??write.effect.unitCostCents*10)/10),
            sourceType:'sale-correction',sourceId:id,businessDate:todayBusinessDate(),
            createdAt:serverTimestamp(),updatedAt:serverTimestamp(),createdBy:userId,updatedBy:userId,
          };
          tx.set(doc(collection(this.db,'stockMovements')),movement);
        }
      }
      const next:Sale={...sale,fulfillmentStatus:draft.target,stockApplied:!newOpen,
        orderAllocations:nextAllocations};
      tx.update(saleRef,{fulfillmentStatus:next.fulfillmentStatus,stockApplied:next.stockApplied,
        orderAllocations:nextAllocations,updatedAt:serverTimestamp(),updatedBy:userId});
      tx.set(doc(collection(this.db,'saleCorrections')),{saleId:id,kind:'fulfillment',
        businessDate:todayBusinessDate(),reason:draft.reason.trim(),
        before:{fulfillmentStatus:oldStage,stockApplied:sale.stockApplied!==false,orderAllocations:oldAllocations},
        after:{fulfillmentStatus:draft.target,stockApplied:!newOpen,orderAllocations:nextAllocations},
        createdAt:serverTimestamp(),updatedAt:serverTimestamp(),createdBy:userId,updatedBy:userId});
      this.revisions.touchTransaction(tx,'sales','inventory');
      return {sale:next,stockChanges:changes};
    });
  }
}
