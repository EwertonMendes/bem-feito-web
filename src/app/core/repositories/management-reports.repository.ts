import { Injectable, inject } from '@angular/core';
import { collection, documentId, DocumentData, QuerySnapshot, getDocs, limit, orderBy, query, startAfter, where } from 'firebase/firestore';
import { FIRESTORE } from '../firebase/firebase.providers';
import { Sale, Payment } from '../../domain/models/sales.model';
import { Expense } from '../../domain/models/finance.model';
import { ManagementReport, ReportCatalogLabels, buildManagementReport } from '../../domain/logic/management-report';
import { isValidBusinessDate } from '../utils/date';

/** Bounded, date-indexed reads; no initial full-collection download or N+1 queries. */
@Injectable({providedIn:'root'})
export class ManagementReportsRepository {
  private readonly db=inject(FIRESTORE);

  async load(from:string,to:string,labels?:ReportCatalogLabels):Promise<ManagementReport>{
    if(!isValidBusinessDate(from)||!isValidBusinessDate(to)||from>to)
      throw new Error('Informe um intervalo de datas válido.');
    const [sales,payments,expenses]=await Promise.all([
      this.period<Sale>('sales',from,to),
      this.period<Payment>('payments',from,to),
      this.period<Expense>('expenses',from,to),
    ]);
    return buildManagementReport(sales,payments,expenses,labels);
  }

  private async period<T extends {id:string;businessDate:string}>(name:string,from:string,to:string):Promise<T[]>{
    const records:T[]=[];
    let cursor:{businessDate:string;id:string}|null=null;
    // This is a user-invoked report query; guard the read budget explicitly.
    // A large period is rejected rather than silently producing a partial report.
    for(let i=0;i<50;i++){
      const documents:QuerySnapshot<DocumentData>=await getDocs(query(collection(this.db,name),
        where('businessDate','>=',from),where('businessDate','<=',to),
        orderBy('businessDate','desc'),orderBy(documentId(),'desc'),
        ...(cursor?[startAfter(cursor.businessDate,cursor.id)]:[]),limit(101)));
      const batch:T[]=documents.docs.slice(0,100).map(item=>({id:item.id,...item.data()} as T));
      records.push(...batch);
      if(documents.docs.length<=100)return records;
      const last:T|undefined=batch.at(-1);
      if(!last)throw new Error('Não foi possível paginar os registros.');
      cursor={businessDate:last.businessDate,id:last.id};
    }
    throw new Error('O período possui muitos lançamentos para este relatório. Selecione um período menor.');
  }
}
