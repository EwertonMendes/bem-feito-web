import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal, viewChild } from '@angular/core';
import { FormField, form, required } from '@angular/forms/signals';
import { standardCostForProduct, trackingModeForInput } from '../../../domain/logic/costing';
import { ProductionDraftItem, ProductionConsumption } from '../../../domain/models/production.model';
import { CatalogStore } from '../../catalog/catalog.store';
import { CatalogReferenceStore } from '../../catalog/catalog-reference.store';
import { ProductionStore } from '../production.store';
import { todayBusinessDate } from '../../../core/utils/date';
import { formatCurrency } from '../../../core/utils/money';
import { BfIcon } from '../../../shared/ui/icon/icon';
import { BfDialog } from '../../../shared/ui/dialog/dialog';
import { BfSelect, BfSelectOption } from '../../../shared/ui/select/select';
import { BfNumberInput } from '../../../shared/ui/number-input/number-input';
interface ProductionLine extends ProductionDraftItem { id: string; }
interface ProductionFormModel { businessDate: string; notes: string; }
interface PreviewConsumption extends ProductionConsumption { name: string; unit: string; mode: 'exact' | 'estimated' | 'untracked'; available: number | null; }
@Component({
 selector: 'bf-production-editor',
 imports: [FormField, BfIcon, BfDialog, BfSelect, BfNumberInput],
 changeDetection: ChangeDetectionStrategy.OnPush,
 templateUrl: './production-editor.html',
 styleUrl: './production-editor.scss',
})
export class BfProductionEditor {
 readonly catalog = inject(CatalogStore);
 readonly references = inject(CatalogReferenceStore);
 readonly store = inject(ProductionStore);
 private readonly destroyRef = inject(DestroyRef);
 private readonly dialog = viewChild.required<BfDialog>('productionDialog');
 readonly currency = formatCurrency;
  readonly submitted = signal(false);
  readonly saving = signal(false);
  readonly formError = signal('');
  readonly model = signal<ProductionFormModel>({ businessDate: todayBusinessDate(), notes: '' });
  readonly productionForm = form(this.model, p => required(p.businessDate));
  readonly lines = signal<ProductionLine[]>([{ id: crypto.randomUUID(), productId: '', quantity: 1 }]);
  readonly selectedDayDate = signal('');
  readonly productOptions = computed<BfSelectOption[]>(() => [
    { value: '', label: 'Selecione um produto' },
    ...this.catalog.activeProducts().map(product => ({
      value: product.id, label: product.displayName,
      description: 'Estoque atual: ' + product.stock, icon: 'product' as const,
    })),
  ]);

  readonly previews = computed(() => {
    const inputMap = new Map(this.catalog.inputs().map(item => [item.id, item]));
    const consumptions = new Map<string, PreviewConsumption>();
    let costCents = 0, pending = false, units = 0;
    for (const line of this.lines()) {
      if (!line.productId || !Number.isSafeInteger(line.quantity) || line.quantity <= 0) continue;
      const product = this.catalog.products().find(item => item.id === line.productId);
      if (!product) continue;
      const refs = {
        collection: this.references.collections().find(item => item.id === product.collectionId),
        fragrance: this.references.fragrances().find(item => item.id === product.fragranceId),
        format: this.references.formats().find(item => item.id === product.formatId),
      };
      try {
        const cost = standardCostForProduct(product, refs, inputMap);
        costCents += cost.unitCostCents * line.quantity;
        units += line.quantity;
        pending ||= cost.costPending;
        for (const part of cost.components) {
          const input = inputMap.get(part.inputId);
          if (!input) continue;
          const unit = this.references.units().find(item => item.id === part.unitId);
          const previous = consumptions.get(part.inputId);
          if (previous) {
            previous.quantity += part.quantity * line.quantity;
            previous.totalCostCents += part.totalCostCents * line.quantity;
          } else {
            consumptions.set(part.inputId, {
              inputId: part.inputId, unitId: part.unitId,
              quantity: part.quantity * line.quantity, unitCostCents: part.unitCostCents,
              totalCostCents: part.totalCostCents * line.quantity,
              name: input.name, unit: unit?.name ?? '',
              mode: trackingModeForInput(input), available: trackingModeForInput(input) === 'untracked' ? null : input.stock,
            });
          }
        }
      } catch {
        pending = true;
      }
    }
    return { costCents, pending, units, consumptions: [...consumptions.values()] };
  });
  readonly blocking = computed(() => this.previews().consumptions.find(
    item => item.mode === 'exact' && (item.available ?? 0) < item.quantity
  ));
 constructor() {
   this.destroyRef.onDestroy(this.catalog.activate());
   this.destroyRef.onDestroy(this.references.activate());
   this.destroyRef.onDestroy(this.store.activate());
 }
  async open(productId = '', date = todayBusinessDate()): Promise<void> {
    await Promise.all([this.catalog.load(), this.references.load()]);
    this.submitted.set(false);
    this.formError.set('');
    this.store.clearOperationError();
    this.model.set({ businessDate: date, notes: '' });
    this.lines.set([{ id: crypto.randomUUID(), productId, quantity: 1 }]);
    this.dialog().open();
  }
  addLine(): void {
    if (this.lines().length >= 60) return;
    this.lines.update(lines => [...lines, { id: crypto.randomUUID(), productId: '', quantity: 1 }]);
  }
  changeProduct(id: string, productId: string): void {
    this.lines.update(lines => lines.map(item => item.id === id ? { ...item, productId } : item));
  }
  changeQuantity(id: string, quantity: number): void {
    this.lines.update(lines => lines.map(item => item.id === id ? { ...item, quantity } : item));
  }
  removeLine(id: string): void {
    this.lines.update(lines => lines.length > 1 ? lines.filter(item => item.id !== id) : lines);
  }
  stockLabel(item: PreviewConsumption): string {
    if (item.mode === 'untracked') return 'Custo sem controle de saldo';
    return (item.mode === 'estimated' ? 'Saldo aproximado: ' : 'Disponível: ') + (item.available ?? 0) + ' ' + item.unit;
  }
  async save(): Promise<void> {
    if (this.saving()) return;
    this.submitted.set(true);
    this.formError.set('');
    const lines = this.lines();
    if (this.productionForm().invalid() || !lines.length ||
        lines.some(item => !item.productId || !Number.isSafeInteger(item.quantity) || item.quantity <= 0)) {
      this.formError.set('Preencha a data e informe um produto e uma quantidade válida em cada linha.');
      return;
    }
    if (this.blocking()) {
      this.formError.set('Saldo controlado insuficiente de ' + this.blocking()!.name + '.');
      return;
    }
    this.saving.set(true);
    try {
      const result = await this.store.createBatch(lines.map(({ productId, quantity }) => ({ productId, quantity })), this.model().businessDate, this.model().notes);
      if (result) { this.catalog.applyStockChanges(result.stockChanges); this.dialog().close(); }
      else this.formError.set(this.store.operationError() || 'Não foi possível registrar a produção.');
    } finally { this.saving.set(false); }
  }
}
