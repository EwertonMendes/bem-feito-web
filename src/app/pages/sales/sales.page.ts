import { BfLoadingButton } from '../../shared/ui/button/loading-button';
import { ChangeDetectionStrategy, Component, DestroyRef, afterNextRender, computed, inject, signal, viewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Sale } from '../../domain/models/sales.model';
import { orderProgress } from '../../domain/logic/order-progress';
import { planSaleProductCorrection, saleCorrectionSignature, SaleProductLineChange } from '../../domain/logic/sale-correction';
import { CatalogStore } from '../../features/catalog/catalog.store';
import { ModalActions } from '../../core/services/modal-actions.service';
import { SalesStore } from '../../features/sales/sales.store';
import { SalesRepository } from '../../core/repositories/sales.repository';
import { ToastService } from '../../core/services/toast.service';
import { ErrorService } from '../../core/services/error.service';
import { formatBusinessDate } from '../../core/utils/date';
import { formatCurrency } from '../../core/utils/money';
import { BfDialog } from '../../shared/ui/dialog/dialog';
import { BfIcon } from '../../shared/ui/icon/icon';
import { BfEmptyState } from '../../shared/ui/empty-state/empty-state';
import { BfPageRefresh } from '../../shared/feedback/page-refresh/page-refresh';
import { BfTableSkeleton } from '../../shared/ui/skeleton/skeleton';

@Component({
  selector: 'bf-sales-page',
  imports: [BfLoadingButton, BfIcon, BfDialog, BfEmptyState, BfPageRefresh, BfTableSkeleton],
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
  readonly historicalMatches = signal<Sale[]>([]);
  readonly historicalQuery = signal('');
  readonly historicalBusy = signal(false);
  readonly historyActive = computed(()=>this.historicalQuery().length>0 && this.search().trim()===this.historicalQuery());
  readonly statusFilter = signal<'all' | 'paid' | 'open' | 'cancelled'>('all');
  readonly pendingAction = signal<'ready' | 'delivered' | 'cancel' | 'allocate' | 'correct' | 'correct-items' | null>(null);
  readonly editingDetails = signal(false);
  readonly editingItems = signal(false);
  readonly productChanges = signal<SaleProductLineChange[]>([]);
  readonly correctionDiscountCents = signal(0);
  readonly correctionReason = signal('');
  readonly correctionSignature = signal('');
  readonly correctionPreview = computed(() => {
    const sale=this.selectedSale();
    if(!sale || !this.editingItems())return null;
    try{return {value:planSaleProductCorrection(sale,{
      expectedSignature:this.correctionSignature(),lines:this.productChanges(),
      discountCents:this.correctionDiscountCents(),reason:this.correctionReason(),
    }),error:''};}catch(error){return {value:null,error:error instanceof Error?error.message:'Revisão inválida.'};}
  });
  readonly metadataDraft = signal({customerName:'',dueDate:'',notes:'',reason:''});
    readonly allocatingLineId = signal<string | null>(null);
  readonly allocationQuantity = signal(1);
  readonly orderProgress = orderProgress;
  private readonly selectedSnapshot = signal<Sale | null>(null);
  readonly selectedSale = computed(() => {
    const snapshot = this.selectedSnapshot();
    return snapshot ? this.store.sales().find(sale => sale.id === snapshot.id) ?? snapshot : null;
  });

  readonly filteredSales = computed(() => {
    const term = this.search().trim().toLocaleLowerCase('pt-BR');
    return (this.historyActive()?this.historicalMatches():this.store.sales()).filter((sale) => {
      if (this.statusFilter() === 'paid' && sale.paymentStatus !== 'paid') return false;
      if (this.statusFilter() === 'open' && !(sale.status === 'active' && sale.balanceCents > 0)) return false;
      if (this.statusFilter() === 'cancelled' && sale.status !== 'cancelled') return false;
      return !term || (sale.code + ' ' + (sale.customerName ?? '')).toLocaleLowerCase('pt-BR').includes(term);
    });
  });

  async searchAllHistory(): Promise<void> {
    const value=this.search().trim();
    if(value.length<2||this.historicalBusy())return;
    this.historicalBusy.set(true);
    this.historicalQuery.set('');
    try {
      this.historicalMatches.set(await this.repository.searchHistorical(value));
      this.historicalQuery.set(value);
    } catch(error) {
      this.toast.error(this.errors.message(error));
    } finally {
      this.historicalBusy.set(false);
    }
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
    this.metadataDraft.set({customerName:sale.customerName??'',dueDate:sale.dueDate??'',notes:sale.notes??'',reason:''});
    this.detailDialog().open();
  }

  openItemCorrection(sale:Sale):void {
    this.editingDetails.set(false);
    this.editingItems.set(true);
    this.productChanges.set(sale.items.filter(item=>item.kind==='product').map(item=>({
      lineId:item.id,quantity:item.quantity,unitPriceCents:item.unitPriceCents,
    })));
    this.correctionDiscountCents.set(sale.discountCents);
    this.correctionReason.set('');
    this.correctionSignature.set(saleCorrectionSignature(sale));
  }

  hasProductLines(sale:Sale):boolean { return sale.items.some(item=>item.kind==='product'); }
  lineChange(id:string):SaleProductLineChange|undefined { return this.productChanges().find(item=>item.lineId===id); }

  patchProductLine(id:string,field:'quantity'|'unitPriceCents',value:number):void {
    this.productChanges.update(lines=>lines.map(item=>item.lineId===id?{...item,[field]:value}:item));
  }

  async correctSelectedItems():Promise<void> {
    if(this.pendingAction())return;
    const sale=this.selectedSale(), preview=this.correctionPreview();
    if(!sale||!preview?.value||this.correctionReason().trim().length<4)return;
    this.pendingAction.set('correct-items');
    try{
      const result=await this.store.correctProductLines(sale.id,{
        expectedSignature:this.correctionSignature(),lines:this.productChanges(),
        discountCents:this.correctionDiscountCents(),reason:this.correctionReason(),
      });
      if(result){
        this.catalog.applyStockChanges(result.stockChanges);
        this.selectedSnapshot.set(result.sale);
        this.editingItems.set(false);
      }
    }finally{this.pendingAction.set(null);}
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

  paymentStatusLabel(sale: Sale): string {
    if (sale.status === 'cancelled') return 'Cancelada';
    if (sale.paymentStatus === 'paid') return 'Pago';
    if (sale.paymentStatus === 'partial') return 'Parcial';
    return 'Pendente';
  }

  clientInitial(sale: Sale): string {
    return sale.customerName?.trim().slice(0, 1).toLocaleUpperCase('pt-BR') || '—';
  }

  clientTone(sale: Sale): string {
    const value = (sale.customerName || sale.code).split('').reduce((sum, char) => sum + char.charCodeAt(0), 0);
    return String(value % 4);
  }
}
