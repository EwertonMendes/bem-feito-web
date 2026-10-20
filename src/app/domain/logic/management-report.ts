import { Sale, Payment, SaleLineSnapshot } from '../models/sales.model';
import { Expense } from '../models/finance.model';
import { PRODUCT_CATEGORIES } from './product-category';

/** Pure report math: money is always integer cents, dates are ISO business dates. */
export interface ReportGroup {
  key:string;
  label:string;
  units:number;
  revenueCents:number;
  cogsCents:number;
  missingCostItems:number;
  grossProfitCents:number;
  marginPercent:number|null;
}
export interface ManagementReport {
  salesCount:number;
  unitsSold:number;
  revenueCents:number;
  receivedCents:number;
  tipsCents:number;
  cogsCents:number;
  grossProfitCents:number;
  operatingExpensesCents:number;
  operationalResultCents:number;
  otherExpensesCents:number;
  inventoryPurchasesCents:number;
  equipmentCents:number;
  missingCostItems:number;
  marginPercent:number|null;
  averageTicketCents:number;
  byCategory:ReportGroup[];
  byProduct:ReportGroup[];
  byCollection:ReportGroup[];
  byFragrance:ReportGroup[];
  byFormat:ReportGroup[];
  byMonth:ReportGroup[];
}
export interface ReportCatalogLabels {
  collection:ReadonlyMap<string,string>;
  fragrance:ReadonlyMap<string,string>;
  format:ReadonlyMap<string,string>;
}
interface MutableGroup {key:string;label:string;units:number;revenueCents:number;cogsCents:number;missingCostItems:number}
const pct=(revenue:number,profit:number):number|null=>revenue>0?Math.round(profit/revenue*1000)/10:null;
function groups(sales:readonly Sale[],getKey:(s:Sale,l:SaleLineSnapshot)=>[string,string]):ReportGroup[]{
  const byKey=new Map<string,MutableGroup>();
  for(const sale of sales){
    for(const [lineIndex,line] of sale.items.entries()){
      const [key,label]=getKey(sale,line);
      const mapKey=key||'unknown';
      const previous=byKey.get(mapKey)??{key:mapKey,label:label||'Sem classificação histórica',
        units:0,revenueCents:0,cogsCents:0,missingCostItems:0};
      const allocated=allocateDiscounts(sale);
      previous.units+=line.quantity;
      previous.revenueCents+=line.totalCents-allocated[lineIndex]!;
      previous.cogsCents+=line.totalCostCents;
      if(line.totalCostCents<=0)previous.missingCostItems++;
      byKey.set(mapKey,previous);
    }
  }
  return [...byKey.values()].map(row=>({
    ...row,grossProfitCents:row.revenueCents-row.cogsCents,
    marginPercent:row.missingCostItems?null:pct(row.revenueCents,row.revenueCents-row.cogsCents),
  })).sort((a,b)=>b.revenueCents-a.revenueCents||a.label.localeCompare(b.label,'pt-BR'));
}
/** Largest remainder allocation preserves exact order discount even with odd cents. */
export function allocateDiscounts(sale:Pick<Sale,'discountCents'|'subtotalCents'|'items'>):number[]{
  if(!sale.items.length)return [];
  const discount=sale.discountCents;
  const subtotal=sale.subtotalCents;
  if(discount<=0||subtotal<=0)return sale.items.map(()=>0);
  const raw=sale.items.map((line,index)=>({index,weighted:discount*line.totalCents/subtotal}));
  const amounts=raw.map(row=>Math.floor(row.weighted));
  let remaining=discount-amounts.reduce((total,v)=>total+v,0);
  for(const row of raw.sort((a,b)=>(b.weighted-Math.floor(b.weighted))-(a.weighted-Math.floor(a.weighted))||a.index-b.index)){
    if(remaining--<=0)break;
    amounts[row.index]!+=1;
  }
  return amounts;
}
export function buildManagementReport(
  sales:readonly Sale[],payments:readonly Payment[],expenses:readonly Expense[],
  labels:ReportCatalogLabels={collection:new Map(),fragrance:new Map(),format:new Map()},
):ManagementReport {
  const active=sales.filter(sale=>sale.status==='active');
  const revenueCents=active.reduce((sum,s)=>sum+s.totalCents,0);
  const cogsCents=active.reduce((sum,s)=>sum+s.items.reduce((v,l)=>v+l.totalCostCents,0),0);
  const missingCostItems=active.reduce((sum,s)=>sum+s.items.filter(l=>l.totalCostCents<=0).length,0);
  const receivedCents=payments.filter(p=>p.status==='active').reduce((sum,p)=>sum+p.appliedCents,0);
  const tipsCents=payments.filter(p=>p.status==='active').reduce((sum,p)=>sum+p.tipCents,0);
  const paid=expenses.filter(e=>e.status!=='cancelled');
  const byKind=(kind:Expense['kind'])=>paid.filter(e=>e.kind===kind).reduce((sum,e)=>sum+e.amountCents,0);
  const operatingExpensesCents=byKind('operating-expense');
  const grossProfitCents=revenueCents-cogsCents;
  const fallback=(key:string,dict:ReadonlyMap<string,string>)=>dict.get(key)??'Sem classificação histórica';
  const keyFor=(type:'collection'|'fragrance'|'format')=>(sale:Sale,line:SaleLineSnapshot):[string,string]=>{
    if(line.kind==='addition')return ['addition','Adicionais'];
    const key=type==='collection'?line.collectionId:type==='fragrance'?line.fragranceId:line.formatId;
    return [key??'unknown',fallback(key??'',labels[type])];
  };
  return {
    salesCount:active.length,
    unitsSold:active.reduce((n,s)=>n+s.items.filter(i=>i.kind==='product').reduce((m,i)=>m+i.quantity,0),0),
    revenueCents,receivedCents,tipsCents,cogsCents,grossProfitCents,operatingExpensesCents,
    operationalResultCents:grossProfitCents-operatingExpensesCents+tipsCents,
    otherExpensesCents:byKind('other'),inventoryPurchasesCents:byKind('input-purchase'),
    equipmentCents:byKind('equipment'),missingCostItems,
    marginPercent:missingCostItems?null:pct(revenueCents,grossProfitCents),
    averageTicketCents:active.length?Math.round(revenueCents/active.length):0,
    byCategory:groups(active,(_sale,line)=>{
      if (line.kind === 'addition') return ['addition', 'Adicionais'];
      const id = line.categoryId ?? 'soap';
      return [id, PRODUCT_CATEGORIES.find(category => category.id === id)?.label ?? id];
    }),
    byProduct:groups(active,(_sale,line)=>[line.kind+':'+line.sourceId,line.name]),
    byCollection:groups(active,keyFor('collection')),
    byFragrance:groups(active,keyFor('fragrance')),
    byFormat:groups(active,keyFor('format')),
    byMonth:groups(active,(sale)=>[sale.businessDate.slice(0,7),sale.businessDate.slice(0,7)]).sort((a,b)=>a.key.localeCompare(b.key)),
  };
}
