import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal, viewChild } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormField, form, required } from '@angular/forms/signals';
import { CatalogReferenceStore } from '../../features/catalog/catalog-reference.store';
import { CatalogStore } from '../../features/catalog/catalog.store';
import { InventoryStore } from '../../features/inventory/inventory.store';
import { todayBusinessDate, formatBusinessDate } from '../../core/utils/date';
import { formatCurrency } from '../../core/utils/money';
import { BfIcon } from '../../shared/ui/icon/icon';
import { BfEmptyState } from '../../shared/ui/empty-state/empty-state';
import { BfDialog } from '../../shared/ui/dialog/dialog';
import { CatalogImage } from '../../shared/media/catalog-image/catalog-image';

interface AdjustmentModel {
  quantity: number;
  reason: string;
  businessDate: string;
}

@Component({
  selector: 'bf-inventory-page',
  imports: [FormField, BfIcon, CatalogImage, BfDialog, BfEmptyState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './inventory.page.html',
  styleUrl: './inventory.page.scss',
})
export class InventoryPage {
  readonly catalog = inject(CatalogStore);
  readonly references = inject(CatalogReferenceStore);
  readonly store = inject(InventoryStore);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly adjustmentDialog = viewChild.required<BfDialog>('adjustmentDialog');
  private readonly historyDialog = viewChild.required<BfDialog>('historyDialog');

  readonly tab = signal<'product' | 'input'>('product');
  readonly search = signal('');
  readonly selectedId = signal('');
  readonly selectedType = signal<'product' | 'input'>('product');
  readonly model = signal<AdjustmentModel>({ quantity: 0, reason: '', businessDate: todayBusinessDate() });
  readonly adjustmentForm = form(this.model, (p) => {
    required(p.reason);
    required(p.businessDate);
  });
  readonly currency = formatCurrency;
  readonly date = formatBusinessDate;
  readonly filteredProducts = computed(() => {
    const term = this.search().toLocaleLowerCase('pt-BR').trim();
    return this.catalog.products().filter((item) => !term || (item.displayName + item.code).toLocaleLowerCase('pt-BR').includes(term));
  });
  readonly filteredInputs = computed(() => {
    const term = this.search().toLocaleLowerCase('pt-BR').trim();
    return this.catalog.inputs().filter((item) => !term || (item.name + item.code).toLocaleLowerCase('pt-BR').includes(term));
  });
  readonly selectedName = computed(() => {
    if (this.selectedType() === 'product') return this.catalog.products().find((item) => item.id === this.selectedId())?.displayName ?? '';
    return this.catalog.inputs().find((item) => item.id === this.selectedId())?.name ?? '';
  });

  constructor() {
    this.destroyRef.onDestroy(() => this.store.deactivateHistory());
    this.destroyRef.onDestroy(this.catalog.activate());
    this.destroyRef.onDestroy(this.references.activate());
    void Promise.all([this.catalog.load(), this.references.load()]).then(() => {
      if (this.route.snapshot.queryParamMap.get('ajuste') === '1') this.openAdjustmentFromFirst();
    });
  }

  openAdjustment(type: 'product' | 'input', id: string): void {
    this.selectedType.set(type);
    this.selectedId.set(id);
    this.model.set({ quantity: 0, reason: '', businessDate: todayBusinessDate() });
    this.adjustmentDialog().open();
  }

  async openHistory(type: 'product' | 'input', id: string): Promise<void> {
    this.selectedType.set(type);
    this.selectedId.set(id);
    this.store.activateHistory();
    await this.store.loadMovements(id);
    this.historyDialog().open();
  }

  closeHistory(): void {
    this.store.deactivateHistory();
  }

  async saveAdjustment(): Promise<void> {
    if (this.adjustmentForm().invalid() || !this.model().quantity) return;
    const value = this.model();
    const result = await this.store.adjust(this.selectedType(), this.selectedId(), value.quantity, value.reason, value.businessDate);
    if (result) {
      this.catalog.applyStockChanges([result.stockChange]);
      this.adjustmentDialog().close();
    }
  }

  unitName(id: string): string {
    return this.references.units().find((item) => item.id === id)?.name ?? '';
  }

  movementSource(source: string): string {
    const labels: Record<string, string> = {
      sale: 'Venda',
      'sale-cancellation': 'Cancelamento de venda',
      production: 'Produção',
      purchase: 'Compra',
      adjustment: 'Ajuste',
      migration: 'Saldo inicial da migração',
    };
    return labels[source] ?? source;
  }

  private openAdjustmentFromFirst(): void {
    const item = this.catalog.products()[0];
    if (item) this.openAdjustment('product', item.id);
  }
}
