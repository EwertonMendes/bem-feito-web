import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal, viewChild } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormField, form, required } from '@angular/forms/signals';
import { trackingModeForInput } from '../../domain/logic/costing';
import { InputItem } from '../../domain/models/catalog.model';
import { CatalogReferenceStore } from '../../features/catalog/catalog-reference.store';
import { CatalogStore } from '../../features/catalog/catalog.store';
import { InventoryStore } from '../../features/inventory/inventory.store';
import { todayBusinessDate, formatBusinessDate } from '../../core/utils/date';
import { formatCurrency } from '../../core/utils/money';
import { BfIcon } from '../../shared/ui/icon/icon';
import { BfEmptyState } from '../../shared/ui/empty-state/empty-state';
import { BfDialog } from '../../shared/ui/dialog/dialog';
import { CatalogImage } from '../../shared/media/catalog-image/catalog-image';
import { BfPageRefresh } from '../../shared/feedback/page-refresh/page-refresh';
import { BfListSkeleton, BfSkeleton } from '../../shared/ui/skeleton/skeleton';

interface AdjustmentModel {
  quantity: number;
  reason: string;
  businessDate: string;
}

@Component({
  selector: 'bf-inventory-page',
  imports: [FormField, BfIcon, CatalogImage, BfDialog, BfEmptyState, BfPageRefresh, BfListSkeleton, BfSkeleton],
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
  readonly initialized = computed(() => this.catalog.initialized() && this.references.initialized());
  readonly refreshing = computed(() => this.initialized() && (this.catalog.loading() || this.references.loading()));
  readonly selectedName = computed(() => {
    if (this.selectedType() === 'product') return this.catalog.products().find((item) => item.id === this.selectedId())?.displayName ?? '';
    return this.catalog.inputs().find((item) => item.id === this.selectedId())?.name ?? '';
  });
  readonly selectedInputMode = computed(() => {
    if (this.selectedType() !== 'input') return null;
    const input = this.catalog.inputs().find((item) => item.id === this.selectedId());
    return input ? trackingModeForInput(input) : null;
  });

  constructor() {
    this.destroyRef.onDestroy(() => this.store.deactivateHistory());
    this.destroyRef.onDestroy(this.catalog.activate());
    this.destroyRef.onDestroy(this.references.activate());
    void Promise.all([this.catalog.load(), this.references.load()]).then(() => {
      if (this.route.snapshot.queryParamMap.get('ajuste') === '1') this.openAdjustmentFromFirst();
    });
  }

  inputMode(item: InputItem): 'exact' | 'estimated' | 'untracked' {
    return trackingModeForInput(item);
  }

  inputModeLabel(item: InputItem): string {
    const mode = this.inputMode(item);
    if (mode === 'exact') return 'Controlado';
    if (mode === 'untracked') return 'Sem controle de saldo';
    return 'Estimado';
  }

  openAdjustment(type: 'product' | 'input', id: string): void {
    const input = type === 'input' ? this.catalog.inputs().find((item) => item.id === id) : undefined;
    if (input && this.inputMode(input) === 'untracked') return;

    this.selectedType.set(type);
    this.selectedId.set(id);
    const estimated = input && this.inputMode(input) === 'estimated';
    this.model.set({
      quantity: estimated ? input.stock : 0,
      reason: estimated ? 'Conferência de inventário' : '',
      businessDate: todayBusinessDate(),
    });
    this.adjustmentDialog().open();
  }

  async openHistory(type: 'product' | 'input', id: string): Promise<void> {
    this.selectedType.set(type);
    this.selectedId.set(id);
    this.store.activateHistory();
    this.historyDialog().open();
    const loaded = await this.store.loadMovements(id);
    if (!loaded) {
      this.historyDialog().close();
      this.store.deactivateHistory();
    }
  }

  closeHistory(): void {
    this.store.deactivateHistory();
  }

  async saveAdjustment(): Promise<void> {
    if (this.adjustmentForm().invalid()) return;
    const value = this.model();
    let quantityDelta = value.quantity;

    if (this.selectedInputMode() === 'estimated') {
      const input = this.catalog.inputs().find((item) => item.id === this.selectedId());
      if (!input || value.quantity < 0) return;
      quantityDelta = value.quantity - input.stock;
      if (quantityDelta === 0) {
        this.adjustmentDialog().close();
        return;
      }
    } else if (!quantityDelta) {
      return;
    }

    const result = await this.store.adjust(this.selectedType(), this.selectedId(), quantityDelta, value.reason, value.businessDate);
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
