import { ModalActions } from '../../core/services/modal-actions.service';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal, viewChild } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormField, form, required } from '@angular/forms/signals';
import { trackingModeForInput } from '../../domain/logic/costing';
import { planStockAdjustment, StockAdjustmentMode } from '../../domain/logic/stock-adjustment';
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
import { BfNumberInput } from '../../shared/ui/number-input/number-input';

interface AdjustmentModel {
  quantity: number;
  reason: string;
  businessDate: string;
}

@Component({
  selector: 'bf-inventory-page',
  imports: [RouterLink, FormField, BfIcon, CatalogImage, BfDialog, BfEmptyState, BfPageRefresh, BfListSkeleton, BfSkeleton, BfNumberInput],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './inventory.page.html',
  styleUrl: './inventory.page.scss',
})
export class InventoryPage {
  readonly modals = inject(ModalActions);
  readonly catalog = inject(CatalogStore);
  readonly references = inject(CatalogReferenceStore);
  readonly store = inject(InventoryStore);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly adjustmentDialog = viewChild.required<BfDialog>('adjustmentDialog');
  private readonly historyDialog = viewChild.required<BfDialog>('historyDialog');

  readonly tab = signal<'product' | 'input'>('product');
  readonly search = signal('');
  readonly lowOnly = signal(false);
  readonly selectedId = signal('');
  readonly selectedType = signal<'product' | 'input'>('product');
  readonly adjustmentMode = signal<StockAdjustmentMode>('set');
  readonly submitted = signal(false);
  readonly saving = signal(false);
  readonly formError = signal('');
  readonly model = signal<AdjustmentModel>({ quantity: 0, reason: '', businessDate: todayBusinessDate() });
  readonly adjustmentForm = form(this.model, (p) => {
    required(p.reason);
    required(p.businessDate);
  });
  readonly currency = formatCurrency;
  readonly date = formatBusinessDate;
  readonly filteredProducts = computed(() => {
    const term = this.search().toLocaleLowerCase('pt-BR').trim();
    return this.catalog.products().filter((item) => (!this.lowOnly() || item.stock <= item.minimumStock) && (!term || (item.displayName + item.code).toLocaleLowerCase('pt-BR').includes(term)));
  });
  readonly filteredInputs = computed(() => {
    const term = this.search().toLocaleLowerCase('pt-BR').trim();
    return this.catalog.inputs().filter((item) => (!this.lowOnly() || (this.inputMode(item) !== 'untracked' && item.stock <= item.minimumStock)) && (!term || (item.name + item.code).toLocaleLowerCase('pt-BR').includes(term)));
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
  readonly selectedUnitName = computed(() => {
    if (this.selectedType() === 'product') return 'un';
    const input = this.catalog.inputs().find((item) => item.id === this.selectedId());
    return input ? this.unitName(input.unitId) : '';
  });
  readonly selectedStock = computed(() => {
    const item = this.selectedType() === 'product'
      ? this.catalog.products().find((entry) => entry.id === this.selectedId())
      : this.catalog.inputs().find((entry) => entry.id === this.selectedId());
    return item?.stock ?? 0;
  });
  readonly adjustmentPreview = computed(() => {
    try {
      return planStockAdjustment(this.selectedStock(), this.adjustmentMode(), this.model().quantity);
    } catch {
      return null;
    }
  });
  readonly quantityError = computed(() => {
    const quantity = this.model().quantity;
    if (!Number.isFinite(quantity)) return 'Informe uma quantidade válida.';
    if (this.adjustmentMode() === 'set' && quantity < 0) return 'O saldo total não pode ser negativo.';
    if (this.adjustmentMode() === 'delta' && quantity === 0) return 'Informe uma quantidade diferente de zero.';
    if (this.selectedType() === 'product' && !Number.isInteger(quantity)) return 'Produtos acabados exigem quantidade inteira.';
    return '';
  });
  readonly reasonError = computed(() => this.model().reason.trim() ? '' : 'Informe o motivo do ajuste para o histórico.');
  readonly dateError = computed(() => this.model().businessDate ? '' : 'Informe a data do ajuste.');
  readonly formatQuantity = (value: number): string => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 }).format(value);

  constructor() {
    if (this.route.snapshot.queryParamMap.get('tipo') === 'input') this.tab.set('input');
    if (this.route.snapshot.queryParamMap.get('status') === 'low') this.lowOnly.set(true);
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
    this.adjustmentMode.set('set');
    this.submitted.set(false);
    this.saving.set(false);
    this.formError.set('');
    this.store.clearOperationError();
    this.model.set({
      quantity: this.selectedStock(),
      reason: 'Conferência de inventário',
      businessDate: todayBusinessDate(),
    });
    this.adjustmentDialog().open();
  }

  setAdjustmentMode(mode: StockAdjustmentMode): void {
    if (this.saving() || this.adjustmentMode() === mode) return;
    this.adjustmentMode.set(mode);
    this.submitted.set(false);
    this.formError.set('');
    this.store.clearOperationError();
    this.model.update((current) => ({
      ...current,
      quantity: mode === 'set' ? this.selectedStock() : 0,
      reason: mode === 'set' ? 'Conferência de inventário' : 'Movimentação manual de estoque',
    }));
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
    if (this.saving()) return;
    this.submitted.set(true);
    this.formError.set('');
    this.store.clearOperationError();
    const issue = this.quantityError() || this.reasonError() || this.dateError();
    if (issue || this.adjustmentForm().invalid()) {
      this.formError.set(issue || 'Revise os campos obrigatórios antes de registrar.');
      return;
    }

    const preview = this.adjustmentPreview();
    if (!preview || preview.quantityDelta === 0) {
      this.formError.set('O estoque resultante já é o saldo atual. Não há alteração para registrar.');
      return;
    }

    const value = this.model();
    this.saving.set(true);
    try {
      const result = await this.store.reconcile(
        this.selectedType(), this.selectedId(), this.adjustmentMode(),
        value.quantity, value.reason, value.businessDate,
      );
      if (result) {
        this.catalog.applyStockChanges([result.stockChange]);
        this.adjustmentDialog().close();
      } else {
        this.formError.set(this.store.operationError() || 'Não foi possível registrar o ajuste. Tente novamente.');
      }
    } finally {
      this.saving.set(false);
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
