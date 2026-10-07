import { ChangeDetectionStrategy, Component, DestroyRef, afterNextRender, computed, inject, signal, viewChild } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Sale } from '../../domain/models/sales.model';
import { CatalogStore } from '../../features/catalog/catalog.store';
import { SaleEditor } from '../../features/sales/components/sale-editor/sale-editor';
import { SalesStore } from '../../features/sales/sales.store';
import { formatBusinessDate } from '../../core/utils/date';
import { formatCurrency } from '../../core/utils/money';
import { BfDialog } from '../../shared/ui/dialog/dialog';
import { BfIcon } from '../../shared/ui/icon/icon';
import { BfEmptyState } from '../../shared/ui/empty-state/empty-state';
import { BfPageRefresh } from '../../shared/feedback/page-refresh/page-refresh';
import { BfTableSkeleton } from '../../shared/ui/skeleton/skeleton';

@Component({
  selector: 'bf-sales-page',
  imports: [BfIcon, BfDialog, SaleEditor, BfEmptyState, BfPageRefresh, BfTableSkeleton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sales.page.html',
  styleUrl: './sales.page.scss',
})
export class SalesPage {
  readonly store = inject(SalesStore);
  readonly catalog = inject(CatalogStore);
  private readonly destroyRef = inject(DestroyRef);
  private readonly route = inject(ActivatedRoute);
  private readonly detailDialog = viewChild.required<BfDialog>('detailDialog');
  private readonly saleEditor = viewChild.required<SaleEditor>('saleEditor');

  readonly currency = formatCurrency;
  readonly date = formatBusinessDate;
  readonly search = signal('');
  readonly statusFilter = signal<'all' | 'paid' | 'open' | 'cancelled'>('all');
  readonly selectedSale = signal<Sale | null>(null);

  readonly filteredSales = computed(() => {
    const term = this.search().trim().toLocaleLowerCase('pt-BR');
    return this.store.sales().filter((sale) => {
      if (this.statusFilter() === 'paid' && sale.paymentStatus !== 'paid') return false;
      if (this.statusFilter() === 'open' && !(sale.status === 'active' && sale.balanceCents > 0)) return false;
      if (this.statusFilter() === 'cancelled' && sale.status !== 'cancelled') return false;
      return !term || (sale.code + ' ' + (sale.customerName ?? '')).toLocaleLowerCase('pt-BR').includes(term);
    });
  });

  constructor() {
    this.destroyRef.onDestroy(this.store.activateSales());
    this.destroyRef.onDestroy(this.catalog.activate());
    void Promise.all([this.store.load(), this.catalog.load()]);
    const openRequested = this.route.snapshot.queryParamMap.get('novo') === '1';
    afterNextRender(() => {
      if (openRequested) void this.saleEditor().open();
    });
  }

  openDetails(sale: Sale): void {
    this.selectedSale.set(sale);
    this.detailDialog().open();
  }

  async cancelSelected(): Promise<void> {
    const sale = this.selectedSale();
    if (!sale || sale.status === 'cancelled' || !window.confirm('Cancelar ' + sale.code + '? O estoque será revertido e os recebimentos serão estornados.')) return;
    const result = await this.store.cancel(sale);
    if (!result) return;
    this.catalog.applyStockChanges(result.stockChanges);
    this.selectedSale.set(result.sale);
    this.detailDialog().close();
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
