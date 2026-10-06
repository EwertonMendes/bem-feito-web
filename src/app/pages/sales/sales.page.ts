import { ChangeDetectionStrategy, Component, afterNextRender, computed, inject, signal, viewChild } from '@angular/core';
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

@Component({
  selector: 'bf-sales-page',
  imports: [BfIcon, BfDialog, SaleEditor, BfEmptyState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sales.page.html',
  styleUrl: './sales.page.scss',
})
export class SalesPage {
  readonly store = inject(SalesStore);
  readonly catalog = inject(CatalogStore);
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
      return !term || `${sale.code} ${sale.customerName ?? ''}`.toLocaleLowerCase('pt-BR').includes(term);
    });
  });

  constructor() {
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
    if (!sale || sale.status === 'cancelled' || !window.confirm(`Cancelar ${sale.code}? O estoque será revertido e os recebimentos serão estornados.`)) return;
    await this.store.cancel(sale);
    await this.catalog.load(true);
    this.detailDialog().close();
  }

  paymentStatusLabel(sale: Sale): string {
    if (sale.status === 'cancelled') return 'Cancelada';
    if (sale.paymentStatus === 'paid') return 'Pago';
    if (sale.paymentStatus === 'partial') return 'Parcial';
    return 'Pendente';
  }
}
