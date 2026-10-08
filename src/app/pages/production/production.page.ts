import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal, viewChild } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormField, form, min, required } from '@angular/forms/signals';
import { standardCostForProduct, trackingModeForInput } from '../../domain/logic/costing';
import { CatalogReferenceStore } from '../../features/catalog/catalog-reference.store';
import { CatalogStore } from '../../features/catalog/catalog.store';
import { ProductionStore } from '../../features/production/production.store';
import { todayBusinessDate, formatBusinessDate } from '../../core/utils/date';
import { formatCurrency } from '../../core/utils/money';
import { BfIcon } from '../../shared/ui/icon/icon';
import { BfEmptyState } from '../../shared/ui/empty-state/empty-state';
import { BfDialog } from '../../shared/ui/dialog/dialog';
import { CatalogImage } from '../../shared/media/catalog-image/catalog-image';
import { BfPageRefresh } from '../../shared/feedback/page-refresh/page-refresh';
import { BfTableSkeleton } from '../../shared/ui/skeleton/skeleton';
import { BfSelect, BfSelectOption } from '../../shared/ui/select/select';
import { BfNumberInput } from '../../shared/ui/number-input/number-input';

interface ProductionFormModel {
  productId: string;
  quantity: number;
  businessDate: string;
  notes: string;
}

@Component({
  selector: 'bf-production-page',
  imports: [FormField, BfIcon, CatalogImage, BfDialog, BfEmptyState, BfPageRefresh, BfTableSkeleton, BfSelect, BfNumberInput],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './production.page.html',
  styleUrl: './production.page.scss',
})
export class ProductionPage {
  readonly catalog = inject(CatalogStore);
  readonly references = inject(CatalogReferenceStore);
  readonly store = inject(ProductionStore);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dialog = viewChild.required<BfDialog>('productionDialog');

  readonly currency = formatCurrency;
  readonly date = formatBusinessDate;
  readonly submitted = signal(false);
  readonly saving = signal(false);
  readonly formError = signal('');
  readonly model = signal<ProductionFormModel>({ productId: '', quantity: 1, businessDate: todayBusinessDate(), notes: '' });
  readonly productionForm = form(this.model, (p) => {
    required(p.productId);
    required(p.businessDate);
    min(p.quantity, 1);
  });
  readonly formErrors = computed(() => {
    const value = this.model();
    return {
      productId: value.productId ? '' : 'Selecione o produto.',
      quantity: Number.isFinite(value.quantity) && value.quantity >= 1 ? '' : 'Informe uma quantidade de pelo menos 1.',
      businessDate: value.businessDate ? '' : 'Informe a data.',
    };
  });
  readonly productOptions = computed<BfSelectOption[]>(() => [
    { value: '', label: 'Selecione' },
    ...this.catalog.activeProducts().map((product) => ({
      value: product.id,
      label: product.displayName,
      description: `Estoque atual: ${product.stock}`,
      icon: 'product' as const,
    })),
  ]);
  readonly selectedProduct = computed(() => this.catalog.products().find((item) => item.id === this.model().productId));
  readonly costPreview = computed(() => {
    const product = this.selectedProduct();
    if (!product) return null;
    try {
      return standardCostForProduct(product, {
        collection: this.references.collections().find((item) => item.id === product.collectionId),
        fragrance: this.references.fragrances().find((item) => item.id === product.fragranceId),
        format: this.references.formats().find((item) => item.id === product.formatId),
      }, new Map(this.catalog.inputs().map((item) => [item.id, item])));
    } catch {
      return null;
    }
  });
  readonly estimatedConsumptions = computed(() => {
    const preview = this.costPreview();
    if (!preview) return [];
    return preview.components.map((component) => {
      const input = this.catalog.inputs().find((item) => item.id === component.inputId);
      const unit = this.references.units().find((item) => item.id === component.unitId);
      const quantity = component.quantity * this.model().quantity;
      const mode = input ? trackingModeForInput(input) : 'estimated';
      return {
        name: input?.name ?? 'Insumo',
        quantity,
        unit: unit?.name ?? '',
        mode,
        available: mode === 'untracked' ? null : Math.max(0, input?.stock ?? 0),
        enough: mode !== 'exact' || (input?.stock ?? 0) >= quantity,
        unitCostCents: component.unitCostCents,
        totalCostCents: component.totalCostCents * this.model().quantity,
        sources: component.sources.map((source) => source.source),
      };
    });
  });
  readonly estimatedTotalCostCents = computed(() => (this.costPreview()?.unitCostCents ?? 0) * this.model().quantity);
  readonly pendingCostItems = computed(() => this.estimatedConsumptions().filter((item) => item.unitCostCents <= 0));
  readonly blockingConsumptions = computed(() => this.estimatedConsumptions().filter((item) => !item.enough));

  constructor() {
    this.destroyRef.onDestroy(this.catalog.activate());
    this.destroyRef.onDestroy(this.references.activate());
    this.destroyRef.onDestroy(this.store.activate());
    void Promise.all([this.catalog.load(), this.references.load(), this.store.load()]).then(() => {
      if (this.route.snapshot.queryParamMap.get('novo') === '1') this.open();
    });
  }

  open(): void {
    this.submitted.set(false);
    this.formError.set('');
    this.store.clearOperationError();
    this.model.set({ productId: this.catalog.activeProducts()[0]?.id ?? '', quantity: 1, businessDate: todayBusinessDate(), notes: '' });
    this.dialog().open();
  }

  trackingLabel(mode: 'exact' | 'estimated' | 'untracked'): string {
    if (mode === 'exact') return 'controlado';
    if (mode === 'estimated') return 'estimado';
    return 'sem controle de saldo';
  }

  sourceLabel(sources: readonly string[]): string {
    const labels: Record<string, string> = {
      format: 'Formato',
      collection: 'Coleção',
      fragrance: 'Fragrância',
      product: 'Ajuste do produto',
    };
    return [...new Set(sources)].map((source) => labels[source] ?? source).join(' + ');
  }

  stockLabel(item: { mode: 'exact' | 'estimated' | 'untracked'; available: number | null; unit: string }): string {
    if (item.mode === 'untracked') return 'sem controle de saldo';
    return `${item.mode === 'estimated' ? 'saldo aprox.' : 'disponível'} ${item.available ?? 0} ${item.unit}`;
  }

  async save(): Promise<void> {
    if (this.saving()) return;
    this.submitted.set(true);
    this.formError.set('');
    this.store.clearOperationError();

    const errors = this.formErrors();
    if (this.productionForm().invalid() || Object.values(errors).some(Boolean)) {
      this.formError.set('Revise os campos destacados antes de confirmar.');
      return;
    }

    const blocking = this.blockingConsumptions()[0];
    if (blocking) {
      this.formError.set(`Estoque insuficiente de ${blocking.name}: necessário ${blocking.quantity} ${blocking.unit}, disponível ${blocking.available ?? 0} ${blocking.unit}.`);
      return;
    }

    const value = this.model();
    this.saving.set(true);
    try {
      const result = await this.store.create(value.productId, value.quantity, value.businessDate, value.notes);
      if (result) {
        this.catalog.applyStockChanges(result.stockChanges);
        this.dialog().close();
      } else {
        this.formError.set(this.store.operationError() || 'Não foi possível registrar a produção.');
      }
    } finally {
      this.saving.set(false);
    }
  }
}
