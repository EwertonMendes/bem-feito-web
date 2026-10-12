import { inject, Injectable } from '@angular/core';
import { collection, deleteField, doc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { Sale } from '../../domain/models/sales.model';
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
}
