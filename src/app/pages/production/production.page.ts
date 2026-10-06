import { ChangeDetectionStrategy, Component, computed, inject, signal, viewChild } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormField, form, min, required } from '@angular/forms/signals';
import { CatalogReferenceStore } from '../../features/catalog/catalog-reference.store';
import { CatalogStore } from '../../features/catalog/catalog.store';
import { ProductionStore } from '../../features/production/production.store';
import { todayBusinessDate, formatBusinessDate } from '../../core/utils/date';
import { formatCurrency } from '../../core/utils/money';
import { BfIcon } from '../../shared/ui/icon/icon';
import { BfEmptyState } from '../../shared/ui/empty-state/empty-state';
import { BfDialog } from '../../shared/ui/dialog/dialog';
import { CatalogImage } from '../../shared/media/catalog-image/catalog-image';

interface ProductionFormModel {
  productId: string;
  quantity: number;
  businessDate: string;
  notes: string;
}

@Component({
  selector: 'bf-production-page',
  imports: [FormField, BfIcon, CatalogImage, BfDialog, BfEmptyState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './production.page.html',
  styleUrl: './production.page.scss',
})
export class ProductionPage {
  readonly catalog = inject(CatalogStore);
  readonly references = inject(CatalogReferenceStore);
  readonly store = inject(ProductionStore);
  private readonly route = inject(ActivatedRoute);
  private readonly dialog = viewChild.required<BfDialog>('productionDialog');

  readonly currency = formatCurrency;
  readonly date = formatBusinessDate;
  readonly model = signal<ProductionFormModel>({ productId: '', quantity: 1, businessDate: todayBusinessDate(), notes: '' });
  readonly productionForm = form(this.model, (p) => {
    required(p.productId);
    required(p.businessDate);
    min(p.quantity, 1);
  });
  readonly selectedProduct = computed(() => this.catalog.products().find((item) => item.id === this.model().productId));
  readonly estimatedConsumptions = computed(() => {
    const product = this.selectedProduct();
    if (!product) return [];
    return product.recipe.map((component) => {
      const input = this.catalog.inputs().find((item) => item.id === component.inputId);
      const unit = this.references.units().find((item) => item.id === component.unitId);
      const quantity = component.quantity * this.model().quantity;
      return { name: input?.name ?? 'Insumo', quantity, unit: unit?.name ?? '', enough: (input?.stock ?? 0) >= quantity };
    });
  });

  constructor() {
    void Promise.all([this.catalog.load(), this.references.load(), this.store.load()]).then(() => {
      if (this.route.snapshot.queryParamMap.get('novo') === '1') this.open();
    });
  }

  open(): void {
    this.model.set({ productId: this.catalog.activeProducts()[0]?.id ?? '', quantity: 1, businessDate: todayBusinessDate(), notes: '' });
    this.dialog().open();
  }

  async save(): Promise<void> {
    if (this.productionForm().invalid()) return;
    const value = this.model();
    const result = await this.store.create(value.productId, value.quantity, value.businessDate, value.notes);
    if (result) {
      this.catalog.applyStockChanges(result.stockChanges);
      this.dialog().close();
    }
  }
}
