import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { CatalogImageRef } from '../../../../domain/models/image.model';
import { orderSaleCorrectionLines } from './sale-correction-lines';
import {maxSaleLineQuantity,canIncreaseSaleProduct,physicalFreeStock} from '../../../../domain/logic/sale-edit-stock';
import { Sale } from '../../../../domain/models/sales.model';
import { AdvancedSaleLineDraft, AdvancedSalePlan } from '../../../../domain/logic/advanced-sale-edit';
import { formatCurrency } from '../../../../core/utils/money';
import { CatalogStore } from '../../../catalog/catalog.store';
import { CatalogImage } from '../../../../shared/media/catalog-image/catalog-image';
import { BfCheckbox } from '../../../../shared/ui/checkbox/checkbox';
import { BfIcon } from '../../../../shared/ui/icon/icon';
import { CatalogItemPicker, CatalogPickerSelection } from '../catalog-item-picker/catalog-item-picker';

export interface SaleCorrectionLineChange {
  id:string;
  field:'quantity'|'unitPriceCents';
  value:number;
}

/** Presentational sale correction workspace; all financial writes remain in SalesPage/transaction planner. */
@Component({
  selector:'bf-sale-correction-editor',
  imports:[CatalogImage,BfCheckbox,BfIcon,CatalogItemPicker],
  changeDetection:ChangeDetectionStrategy.OnPush,
  templateUrl:'./sale-correction-editor.html',
  styleUrl:'./sale-correction-editor.scss',
})
export class SaleCorrectionEditor {
  readonly catalog=inject(CatalogStore);
  readonly sale=input.required<Sale>();
  readonly lines=input.required<readonly AdvancedSaleLineDraft[]>();
  /** Presentation-only ordering: newest additions first; the draft is unchanged. */
  readonly displayedLines=computed(()=>orderSaleCorrectionLines(this.lines(),this.sale().items));
  readonly discount=input.required<number>();
  readonly reason=input.required<string>();
  readonly preview=input<{value:AdvancedSalePlan|null;error:string}|null>(null);
  readonly stockConfirmed=input.required<boolean>();
  readonly busy=input(false);
  readonly reopenRequired=input(false);
  readonly reopenRequested=output<void>();

  readonly lineChanged=output<SaleCorrectionLineChange>();
  readonly lineRemoved=output<string>();
  readonly linePicked=output<CatalogPickerSelection>();
  readonly discountChange=output<number>();
  readonly reasonChange=output<string>();
  readonly stockConfirmedChange=output<boolean>();

  readonly currency=formatCurrency;
  readonly Math=Math;
  readonly mobileTab=signal<'lines'|'catalog'>('lines');

  advancedLineName(line:AdvancedSaleLineDraft):string {
    const original=this.sale().items.find(item=>item.id===line.id);
    if(original)return original.name;
    return line.kind==='product'
      ?this.catalog.products().find(p=>p.id===line.sourceId)?.displayName??'Produto'
      :this.catalog.additions().find(a=>a.id===line.sourceId)?.name??'Adicional';
  }

  advancedLineImage(line:AdvancedSaleLineDraft):CatalogImageRef|undefined {
    const original=this.sale().items.find(item=>item.id===line.id);
    if(original?.image)return original.image;
    return line.kind==='product'
      ?this.catalog.products().find(p=>p.id===line.sourceId)?.image
      :this.catalog.additions().find(a=>a.id===line.sourceId)?.image;
  }

  advancedLineDetail(line:AdvancedSaleLineDraft):string {
    return line.kind==='product'
      ?this.catalog.products().find(p=>p.id===line.sourceId)?.code??'Produto'
      :this.catalog.additions().find(a=>a.id===line.sourceId)?.category??'Adicional';
  }

  inventoryDeltaName(type:'product'|'input',id:string):string {
    return type==='product'
      ?this.catalog.products().find(p=>p.id===id)?.displayName??id
      :this.catalog.inputs().find(i=>i.id===id)?.name??id;
  }

  maxLineQuantity(line:AdvancedSaleLineDraft):number {
    if(line.kind!=='product')return 100000;
    const product=this.catalog.products().find(p=>p.id===line.sourceId);
    return product?maxSaleLineQuantity(product,this.sale().items,this.lines(),line):line.quantity;
  }
  canIncrease(line:AdvancedSaleLineDraft):boolean {
    if(this.busy()||line.quantity>=100000)return false;
    if(line.kind!=='product')return true;
    const product=this.catalog.products().find(p=>p.id===line.sourceId);
    return !!product && canIncreaseSaleProduct(product,this.sale().items,this.lines());
  }
  stockHint(line:AdvancedSaleLineDraft):string {
    if(line.kind!=='product')return '';
    const product=this.catalog.products().find(p=>p.id===line.sourceId);
    return product?'Livre para acréscimo: '+physicalFreeStock(product):'Produto indisponível';
  }
  updateLine(id:string,field:SaleCorrectionLineChange['field'],value:number):void {
    const line=this.lines().find(x=>x.id===id);
    if(!line)return;
    if(field==='quantity'){
      if(!Number.isFinite(value))return;
      value=Math.max(1,Math.min(Math.trunc(value),Math.max(line.quantity,this.maxLineQuantity(line))));
    }
    this.lineChanged.emit({id,field,value});
  }
  changeLineQuantity(id:string,delta:number):void {
    const line=this.lines().find(x=>x.id===id);
    if(line && (delta<0 || this.canIncrease(line)))this.updateLine(id,'quantity',Math.max(1,line.quantity+delta));
  }
}
