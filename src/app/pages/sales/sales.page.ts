import { BfLoadingButton } from '../../shared/ui/button/loading-button';
import { ChangeDetectionStrategy, Component, DestroyRef, afterNextRender, computed, inject, signal, viewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Sale } from '../../domain/models/sales.model';
import { orderProgress } from '../../domain/logic/order-progress';
import { saleCorrectionSignature } from '../../domain/logic/sale-correction';
import { planShippingCorrection, shippingCorrectionSignature } from '../../domain/logic/shipping-correction';
import { AdvancedSaleLineDraft, planAdvancedSaleEdit } from '../../domain/logic/advanced-sale-edit';
import { CatalogStore } from '../../features/catalog/catalog.store';
import { ModalActions } from '../../core/services/modal-actions.service';
import { SalesStore } from '../../features/sales/sales.store';
import { SalesRepository } from '../../core/repositories/sales.repository';
import { ToastService } from '../../core/services/toast.service';
import { ErrorService } from '../../core/services/error.service';
import { formatBusinessDate } from '../../core/utils/date';
import { formatCurrency } from '../../core/utils/money';
import { downloadCsv, exportCents } from '../../core/utils/csv-export';
import { BfDialog } from '../../shared/ui/dialog/dialog';
import { BfSelect } from '../../shared/ui/select/select';
import { CatalogPickerSelection } from '../../features/sales/components/catalog-item-picker/catalog-item-picker';
import { SaleCorrectionEditor } from '../../features/sales/components/sale-correction-editor/sale-correction-editor';
import { BfCheckbox } from '../../shared/ui/checkbox/checkbox';
import { BusinessDateCursor } from '../../core/repositories/pagination';
import { BfIcon } from '../../shared/ui/icon/icon';
import { BfEmptyState } from '../../shared/ui/empty-state/empty-state';
import { BfPageRefresh } from '../../shared/feedback/page-refresh/page-refresh';
import { BfTableSkeleton } from '../../shared/ui/skeleton/skeleton';
import { BfSaleStatusChip } from '../../features/sales/components/sale-status-chip/sale-status-chip';

@Component({
  selector: 'bf-sales-page',
  imports: [BfLoadingButton, BfIcon, BfDialog, BfSelect, BfCheckbox, SaleCorrectionEditor, BfEmptyState, BfPageRefresh, BfTableSkeleton, BfSaleStatusChip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sales.page.html',
  styleUrl: './sales.page.scss',
})
export class SalesPage {
  readonly store = inject(SalesStore);
  private readonly repository = inject(SalesRepository);
  private readonly toast = inject(ToastService);
  private readonly errors = inject(ErrorService);
  readonly catalog = inject(CatalogStore);
  private readonly destroyRef = inject(DestroyRef);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly detailDialog = viewChild.required<BfDialog>('detailDialog');
  readonly modals = inject(ModalActions);

  readonly currency = formatCurrency;
  readonly date = formatBusinessDate;
  readonly search = signal('');
  readonly exporting = signal(false);
  readonly historicalMatches = signal<Sale[]>([]);
  readonly historicalQuery = signal('');
  readonly historySubmitted = signal(false);
  readonly historyHasMore = signal(false);
  readonly historyCursor = signal<BusinessDateCursor | null>(null);
  readonly historyFrom = signal('');
  readonly historyTo = signal('');
  readonly historyProduct = signal('');
  readonly productFilterOptions = computed(() => [{value:'',label:'Todos os sabonetes'},
    ...this.catalog.activeProducts().map(product=>({value:product.id,label:product.displayName}))]);
  readonly historicalBusy = signal(false);
  readonly advancedFiltersOpen = signal(false);
  readonly activeAdvancedFilterCount = computed(() =>
    Number(Boolean(this.historyFrom())) + Number(Boolean(this.historyTo())) + Number(Boolean(this.historyProduct())));
  readonly historyActive = computed(()=>this.historySubmitted() && this.search().trim()===this.historicalQuery());
  readonly statusFilter = signal<'all' | 'paid' | 'open' | 'cancelled'>('all');
  readonly pendingAction = signal<'ready' | 'delivered' | 'cancel' | 'allocate' | 'correct' | 'correct-items' | 'shipping' | null>(null);
  readonly editingDetails = signal(false);
  readonly editingItems = signal(false);
  readonly editingShipping = signal(false);
  readonly shippingAmount = signal(0);
  readonly shippingReclassify = signal(false);
  readonly shippingReason = signal('');
  readonly openingItemEditor = signal(false);
  private readonly editBaseline = signal<Sale | null>(null);
  readonly advancedChanges=signal<AdvancedSaleLineDraft[]>([]);
  readonly correctionDiscountCents=signal(0);
  readonly correctionReason=signal('');
  readonly advancedStockConfirmed=signal(false);
  readonly correctionSignature=signal('');
  readonly correctionPreview=computed(()=>{
    const sale=this.editBaseline();
    if(!sale||!this.editingItems())return null;
    try{
      const catalog={
        products:new Map(this.catalog.products().map(p=>[p.id,p])),
        additions:new Map(this.catalog.additions().map(a=>[a.id,a])),
        inputs:new Map(this.catalog.inputs().map(i=>[i.id,i])),
      };
      const reason=this.correctionReason().trim().length>=4?this.correctionReason():'Prévia para conferência';
      return {value:planAdvancedSaleEdit(sale,{
        expectedSignature:this.correctionSignature(),lines:this.advancedChanges(),
        discountCents:this.correctionDiscountCents(),reason,
      },catalog),error:''};
    }catch(error){return {value:null,error:error instanceof Error?error.message:'Alterações inválidas.'};}
  });
  readonly shippingPreview = computed(() => {
    const sale = this.editBaseline();
    if (!sale || !this.editingShipping()) return null;
    try {
      return {value:planShippingCorrection(sale,Math.round(this.shippingAmount()*100),this.shippingReclassify()),error:''};
    } catch(error) {
      return {value:null,error:error instanceof Error?error.message:'Frete inválido.'};
    }
  });
  readonly metadataDraft = signal({customerName:'',dueDate:'',notes:'',reason:''});
    readonly allocatingLineId = signal<string | null>(null);
  readonly allocationQuantity = signal(1);
  readonly orderProgress = orderProgress;
  private readonly selectedSnapshot = signal<Sale | null>(null);
  readonly selectedSale = computed(() => {
    if((this.editingItems() || this.editingShipping()) && this.editBaseline())return this.editBaseline();
    const snapshot = this.selectedSnapshot();
    return snapshot ? this.store.sales().find(sale => sale.id === snapshot.id) ?? snapshot : null;
  });

  readonly filteredSales = computed(() => {
    if(this.historyActive())return this.historicalMatches();
    const term=this.search().trim().toLocaleLowerCase('pt-BR');
    return this.store.sales().filter(sale=>{
      if(this.statusFilter()==='paid'&&sale.paymentStatus!=='paid')return false;
      if(this.statusFilter()==='open'&&!(sale.status==='active'&&sale.balanceCents>0))return false;
      if(this.statusFilter()==='cancelled'&&sale.status!=='cancelled')return false;
      return !term||(sale.code+' '+(sale.customerName??'')).toLocaleLowerCase('pt-BR').includes(term);
    });
  });

  readonly searchFilters = computed(() => ({
    status:this.statusFilter(),from:this.historyFrom(),to:this.historyTo(),productId:this.historyProduct(),
  }));
  readonly appliedHistoryFilters=signal<ReturnType<typeof this.searchFilters> | null>(null);

  setHistoryStatus(status:'all'|'paid'|'open'|'cancelled'):void {
    this.statusFilter.set(status);
    if(this.historyActive())void this.searchAllHistory();
  }

  clearSalesFilters():void {
    this.search.set('');
    this.historyFrom.set('');this.historyTo.set('');this.historyProduct.set('');
    this.statusFilter.set('all');this.historySubmitted.set(false);
    this.historicalQuery.set('');this.historicalMatches.set([]);
    this.historyHasMore.set(false);this.historyCursor.set(null);
    this.appliedHistoryFilters.set(null);
  }

  async loadMoreHistory():Promise<void>{
    if(!this.historyActive()||!this.historyHasMore()||this.historicalBusy())return;
    this.historicalBusy.set(true);
    try{
      const page=await this.repository.searchHistoricalPage(this.historicalQuery(),this.appliedHistoryFilters()??{},this.historyCursor());
      this.historicalMatches.update(old=>[...old,...page.items.filter(item=>!old.some(x=>x.id===item.id))]);
      this.historyHasMore.set(page.hasMore);this.historyCursor.set(page.nextCursor);
    }catch(error){this.toast.error(this.errors.message(error));}
    finally{this.historicalBusy.set(false);}
  }

  async exportAllSales():Promise<void> {
    if(this.exporting())return;
    this.exporting.set(true);
    try{
      const rows:Sale[]=[];
      let cursor:{businessDate:string;id:string}|null=null;
      for(let page=0;page<1000;page++){
        const batch=await this.repository.page(100,cursor);
        rows.push(...batch.items);
        if(!batch.hasMore){cursor=null;break;}
        if(!batch.nextCursor)throw new Error('Paginação incompleta: exportação interrompida.');
        cursor=batch.nextCursor;
      }
      if(cursor!==null)throw new Error('Exportação excedeu o limite seguro. Utilize um período menor.');
      downloadCsv('bem-feito-vendas.csv',
        ['Código','Data','Cliente','Situação','Entrega','Valor total (R$)','Frete (R$)','Recebido (R$)','Saldo (R$)','Gorjetas (R$)','Itens'],
        rows.map(sale=>[sale.code,sale.businessDate,sale.customerName??'',sale.status,
          sale.fulfillmentStatus??'delivered',exportCents(sale.totalCents),exportCents(sale.shippingFeeCents??0),
          exportCents(sale.receivedCents),exportCents(sale.balanceCents),
          exportCents(sale.tipCents),sale.items.map(item=>item.quantity+'x '+item.name).join(' | ')]));
      this.toast.success('Arquivo CSV de vendas gerado.');
    }catch(error){this.toast.error(this.errors.message(error));}
    finally{this.exporting.set(false);}
  }

  async searchAllHistory(): Promise<void> {
    const value=this.search().trim();
    if(value.length===1||this.historicalBusy())return;
    this.historicalBusy.set(true);
    this.historySubmitted.set(false);
    try{
      const filters=this.searchFilters();
      const page=await this.repository.searchHistoricalPage(value,filters);
      this.appliedHistoryFilters.set(filters);
      this.historicalMatches.set(page.items);this.historyHasMore.set(page.hasMore);
      this.historyCursor.set(page.nextCursor);
      this.historicalQuery.set(value);this.historySubmitted.set(true);
    }catch(error){this.toast.error(this.errors.message(error));}
    finally{this.historicalBusy.set(false);}
  }

  constructor() {
    this.destroyRef.onDestroy(this.store.activateSales());
    this.destroyRef.onDestroy(this.catalog.activate());
    void Promise.all([this.store.load(), this.catalog.load()]);
    const initialProductId = this.route.snapshot.queryParamMap.get('produto') ?? undefined;
    const openRequested = this.route.snapshot.queryParamMap.get('novo') === '1' || !!initialProductId;
    afterNextRender(() => {
      if (openRequested) {
        void this.router.navigate([], {
          relativeTo: this.route, queryParams: { novo: null, produto: null },
          queryParamsHandling: 'merge', replaceUrl: true,
        }).then(() => this.modals.openSale(initialProductId));
      }
    });
  }

  openDetails(sale: Sale): void {
    if (this.pendingAction()) return;
    this.selectedSnapshot.set(sale);
    this.editingDetails.set(false);
    this.editingItems.set(false);
    this.editingShipping.set(false);
    this.editBaseline.set(null);
    this.metadataDraft.set({customerName:sale.customerName??'',dueDate:sale.dueDate??'',notes:sale.notes??'',reason:''});
    this.detailDialog().open();
  }

  async openItemCorrection(sale:Sale):Promise<void> {
    if(this.pendingAction() || this.openingItemEditor())return;
    this.openingItemEditor.set(true);
    try{
      const current=await this.repository.findByIdFromServer(sale.id);
      if(!current || current.status!=='active'){
        this.toast.error('A venda não está mais disponível para edição.');
        return;
      }
      // Discard responses for a different sale after the dialog selection changes.
      if(this.selectedSnapshot()?.id!==sale.id)return;
      // Keep the immutable editor base independent from the list-store refresh.
      this.editBaseline.set(current);
      this.selectedSnapshot.set(current);
      this.editingDetails.set(false);
      this.editingShipping.set(false);
      this.advancedChanges.set(current.items.map(i=>({
        id:i.id,kind:i.kind,sourceId:i.sourceId,
        quantity:i.quantity,unitPriceCents:i.unitPriceCents,
      })));
      this.correctionDiscountCents.set(current.discountCents);
      this.correctionReason.set('');
      this.advancedStockConfirmed.set(false);
      this.correctionSignature.set(saleCorrectionSignature(current));
      this.editingItems.set(true);
    }catch(error){
      this.toast.error(this.errors.message(error));
    }finally{
      this.openingItemEditor.set(false);
    }
  }
  cancelItemCorrection():void {
    this.editingItems.set(false);
    this.editBaseline.set(null);
  }
  readonly Math=Math;
  hasProductLines(sale:Sale):boolean {return sale.items.length>0;}
  patchAdvancedLine(id:string,field:'quantity'|'unitPriceCents',value:number):void{
    this.advancedChanges.update(lines=>lines.map(line=>line.id===id?{...line,[field]:value}:line));
  }
  removeAdvancedLine(id:string):void{
    this.advancedChanges.update(lines=>lines.filter(line=>line.id!==id));
  }
  addAdvancedLine(selection:CatalogPickerSelection):void {
    const {sourceId,kind}=selection;
    const product=kind==='product'?this.catalog.activeProducts().find(p=>p.id===sourceId):undefined;
    const addition=kind==='addition'?this.catalog.activeAdditions().find(a=>a.id===sourceId):undefined;
    if(!product&&!addition)return;
    this.advancedChanges.update(lines=>{
      const existing=lines.find(x=>x.kind===kind&&x.sourceId===sourceId);
      if(existing)return lines.map(x=>x.id===existing.id?{...x,quantity:x.quantity+1}:x);
      return [...lines,{
        id:crypto.randomUUID(),kind,sourceId,quantity:1,
        unitPriceCents:product?.salePriceCents??addition?.priceCents??0,
      }];
    });
    this.advancedStockConfirmed.set(false);
  }

  hasUnsavedItemCorrection():boolean {
    const sale=this.editBaseline();
    if(!sale)return false;
    if(this.correctionReason().trim() || this.correctionDiscountCents()!==sale.discountCents)return true;
    const draft=this.advancedChanges();
    return draft.length!==sale.items.length || draft.some((line,index)=>{
      const original=sale.items[index];
      return !original || line.id!==original.id || line.kind!==original.kind ||
        line.sourceId!==original.sourceId || line.quantity!==original.quantity ||
        line.unitPriceCents!==original.unitPriceCents;
    });
  }

  confirmDiscardCorrection():boolean {
    return !this.editingItems() || !this.hasUnsavedItemCorrection() ||
      window.confirm('Descartar as alterações não salvas desta venda?');
  }

  closeSaleDetails():void {
    if(!this.confirmDiscardCorrection())return;
    if(this.editingItems())this.cancelItemCorrection();
    this.detailDialog().close();
  }

  onDetailCancel(event:Event):void {
    if(!this.editingItems())return;
    event.preventDefault();
    this.closeSaleDetails();
  }

  discardItemCorrection():void {
    if(this.confirmDiscardCorrection())this.cancelItemCorrection();
  }

  async correctSelectedItems():Promise<void>{
    if(this.pendingAction())return;
    const sale=this.editBaseline(),preview=this.correctionPreview();
    if(!sale||!preview?.value||this.correctionReason().trim().length<4)return;
    this.pendingAction.set('correct-items');
    try{
      const result=await this.store.correctAdvancedSale(sale.id,{
        expectedSignature:this.correctionSignature(),lines:this.advancedChanges(),
        discountCents:this.correctionDiscountCents(),reason:this.correctionReason(),
        stockReconciliationConfirmed:this.advancedStockConfirmed(),
      });
      if(result){
        this.catalog.applyStockChanges(result.stockChanges);
        this.selectedSnapshot.set(result.sale);
        this.editingItems.set(false);
        this.editBaseline.set(null);
      }
    }finally{this.pendingAction.set(null);}
  }

  async openShippingCorrection(sale: Sale): Promise<void> {
    if (this.pendingAction() || this.openingItemEditor()) return;
    this.openingItemEditor.set(true);
    try {
      const current = await this.repository.findByIdFromServer(sale.id);
      if (!current || current.status !== 'active') throw new Error('Venda indisponível.');
      if (this.selectedSnapshot()?.id !== sale.id) return;
      this.selectedSnapshot.set(current);
      this.editBaseline.set(current);
      this.editingDetails.set(false);
      this.editingItems.set(false);
      this.shippingAmount.set((current.shippingFeeCents??0)/100);
      this.shippingReclassify.set(false);
      this.shippingReason.set('');
      this.editingShipping.set(true);
    } catch(error) {
      this.toast.error(this.errors.message(error));
    } finally {
      this.openingItemEditor.set(false);
    }
  }

  cancelShippingCorrection(): void {
    this.editingShipping.set(false);
    this.editBaseline.set(null);
  }

  async saveShippingCorrection(): Promise<void> {
    const sale = this.editBaseline();
    const plan = this.shippingPreview();
    if (!sale || !plan?.value || this.pendingAction() || this.shippingReason().trim().length<4) return;
    this.pendingAction.set('shipping');
    try {
      const updated = await this.store.correctShipping(sale.id,{
        shippingFeeCents:Math.round(this.shippingAmount()*100),
        reclassifyTip:this.shippingReclassify(),
        expectedSignature:shippingCorrectionSignature(sale),
        reason:this.shippingReason(),
      });
      if (updated) {
        this.selectedSnapshot.set(updated);
        this.editingShipping.set(false);
        this.editBaseline.set(null);
      }
    } finally {
      this.pendingAction.set(null);
    }
  }

  showAllocation(lineId: string): void {
    this.allocatingLineId.set(this.allocatingLineId() === lineId ? null : lineId);
    this.allocationQuantity.set(1);
  }

  patchMetadata(field:'customerName'|'dueDate'|'notes'|'reason',value:string):void {
    this.metadataDraft.update(draft=>({...draft,[field]:value}));
  }

  async saveMetadata():Promise<void>{
    const sale=this.selectedSale(),draft=this.metadataDraft();
    if(!sale||this.pendingAction()||draft.reason.trim().length<4)return;
    this.pendingAction.set('correct');
    try{
      const updated=await this.store.correctMetadata(sale.id,draft);
      if(updated){this.selectedSnapshot.set(updated);this.editingDetails.set(false);}
    }finally{this.pendingAction.set(null);}
  }

  async allocateSelected(lineId: string): Promise<void> {
    if (this.pendingAction()) return;
    const sale = this.selectedSale();
    const item = sale?.items.find(x=>x.id===lineId);
    if (!sale || !item || sale.status !== 'active' || sale.fulfillmentStatus !== 'in-production') return;
    const pending = this.orderProgress(sale).find(x=>x.line.id===lineId)?.pending;
    const quantity = this.allocationQuantity();
    if (pending === null || pending === undefined || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > pending) return;
    this.pendingAction.set('allocate');
    try {
      const result = await this.store.allocateOrderLine(sale.id,lineId,quantity);
      if (result) {
        this.catalog.applyStockChanges(result.stockChanges);
        this.selectedSnapshot.set(result.sale);
        this.allocatingLineId.set(null);
      }
    } finally {
      this.pendingAction.set(null);
    }
  }

  fulfillmentLabel(sale: Sale): string {
    if (sale.status === 'cancelled') return 'Cancelada';
    const status = sale.fulfillmentStatus ?? 'delivered';
    return status === 'in-production' ? 'Em produção' : status === 'ready' ? 'Pronto' : 'Entregue';
  }

  async advanceSelected(next: 'ready' | 'delivered'): Promise<void> {
    if (this.pendingAction()) return;
    const sale = this.selectedSale();
    if (!sale || sale.status !== 'active') return;
    this.pendingAction.set(next);
    try {
      const result = await this.store.advanceFulfillment(sale.id, next);
      if (!result) return;
      this.catalog.applyStockChanges(result.stockChanges);
      this.selectedSnapshot.set(result.sale);
    } finally {
      this.pendingAction.set(null);
    }
  }

  async cancelSelected(): Promise<void> {
    if (this.pendingAction()) return;
    const sale = this.selectedSale();
    if (!sale || sale.status === 'cancelled' || !window.confirm('Cancelar ' + sale.code + '? O estoque será revertido e os recebimentos serão estornados.')) return;
    this.pendingAction.set('cancel');
    try {
      const result = await this.store.cancel(sale);
      if (!result) return;
      this.catalog.applyStockChanges(result.stockChanges);
      this.selectedSnapshot.set(result.sale);
      this.detailDialog().closeAfterSuccess();
    } finally {
      this.pendingAction.set(null);
    }
  }

  clientInitial(sale: Sale): string {
    return sale.customerName?.trim().slice(0, 1).toLocaleUpperCase('pt-BR') || '—';
  }

  clientTone(sale: Sale): string {
    const value = (sale.customerName || sale.code).split('').reduce((sum, char) => sum + char.charCodeAt(0), 0);
    return String(value % 4);
  }
}
