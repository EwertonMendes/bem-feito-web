import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal, viewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Production, ProductionItem, ProductionConsumption, ProductionCorrectionHistory } from '../../domain/models/production.model';
import { standardCostForProduct } from '../../domain/logic/costing';
import { ProductionCorrectionEditor } from '../../features/production/components/production-correction-editor';
import { ProductionCorrectionService } from '../../features/production/production-correction.service';
import { productionItems } from '../../domain/logic/production-correction';
import { CatalogStore } from '../../features/catalog/catalog.store';
import { CatalogReferenceStore } from '../../features/catalog/catalog-reference.store';
import { ProductionStore } from '../../features/production/production.store';
import { BfProductionEditor } from '../../features/production/components/production-editor';
import { todayBusinessDate, formatBusinessDate } from '../../core/utils/date';
import { formatCurrency } from '../../core/utils/money';
import { BfIcon } from '../../shared/ui/icon/icon';
import { BfEmptyState } from '../../shared/ui/empty-state/empty-state';
import { BfDialog } from '../../shared/ui/dialog/dialog';
import { BfLoadingButton } from '../../shared/ui/button/loading-button';
import { BfSelect, BfSelectOption } from '../../shared/ui/select/select';
import { BfPageRefresh } from '../../shared/feedback/page-refresh/page-refresh';
import { BfTableSkeleton } from '../../shared/ui/skeleton/skeleton';
interface ProductionDay { date: string; entries: Production[]; quantity: number; totalCents: number; pending: boolean; products: number; reestimated: boolean; }
@Component({
 selector: 'bf-production-page',
 imports: [BfIcon, BfLoadingButton, BfDialog, BfEmptyState, BfPageRefresh, BfTableSkeleton, BfProductionEditor, ProductionCorrectionEditor, BfSelect],
 changeDetection: ChangeDetectionStrategy.OnPush,
 templateUrl: './production.page.html',
 styleUrl: './production.page.scss',
})
export class ProductionPage {
 readonly catalog = inject(CatalogStore);
 readonly references = inject(CatalogReferenceStore);
 readonly store = inject(ProductionStore);
 readonly corrections = inject(ProductionCorrectionService);
 private readonly route = inject(ActivatedRoute);
 private readonly router = inject(Router);
 private readonly destroyRef = inject(DestroyRef);
 private readonly productionEditor = viewChild.required<BfProductionEditor>('productionEditor');
 private readonly detailDialog = viewChild.required<BfDialog>('detailDialog');
 private readonly correctionEditor = viewChild.required<ProductionCorrectionEditor>('correctionEditor');
 readonly historyEntryId = signal('');
 readonly historyLoading = signal(false);
 readonly historyError = signal('');
 readonly selectedHistory = signal<ProductionCorrectionHistory[]>([]);
 readonly currency = formatCurrency;
 readonly date = formatBusinessDate;
 readonly selectedDayDate = signal('');
 readonly filterDate = signal('');
 readonly filterProduct = signal('');
 readonly filterCost = signal<'all' | 'partial' | 'complete'>('all');
 readonly costFilterOptions: readonly BfSelectOption[] = [
   {value:'all',label:'Todos'}, {value:'complete',label:'Calculado'}, {value:'partial',label:'Parcial'},
 ];
 changeCostFilter(value: string): void {
   if (value === 'all' || value === 'complete' || value === 'partial') this.filterCost.set(value);
 }
  readonly days = computed<ProductionDay[]>(() => {
    const byDate = new Map<string, ProductionDay>();
    for (const entry of this.store.items()) {
      const day = byDate.get(entry.businessDate) ?? {
        date: entry.businessDate, entries: [], quantity: 0, totalCents: 0, pending: false, products: 0, reestimated: false,
      };
      day.entries.push(entry);
      if (entry.status !== 'cancelled') {
        day.quantity += entry.quantity;
        const preview = this.displayItemsFor(entry);
        day.totalCents += preview.reduce((sum, item) => sum + item.totalCostCents, 0);
        day.pending ||= preview.some(item => item.costPending);
        day.reestimated ||= entry.costPending && preview.some(item => !item.costPending);
      }
      byDate.set(day.date, day);
    }
    for (const day of byDate.values()) day.products = new Set(
      day.entries.filter(entry => entry.status !== 'cancelled').flatMap(entry => this.itemsFor(entry).map(item => item.productId))
    ).size;
    return [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date));
  });
  readonly selectedDay = computed(() => this.days().find(day => day.date === this.selectedDayDate()));
  readonly missingCostReferences = computed(() =>
    [...new Set((this.selectedDay()?.entries ?? [])
      .flatMap(entry => this.displayItemsFor(entry).flatMap(item => item.missingCostReferences ?? [])))]);
  readonly detailEstimates = computed(() => {
    const groups = new Map<string, { pool: string; quantity: number; totalCostCents: number }>();
    for (const entry of this.selectedDay()?.entries ?? []) {
      if (entry.status === 'cancelled') continue;
      for (const part of this.displayItemsFor(entry)) {
        for (const line of part.estimatedCosts ?? []) {
          const previous = groups.get(line.pool);
          const cost = Math.round(line.unitCostCents * line.quantity * part.quantity);
          groups.set(line.pool, { pool: line.pool,
            quantity: (previous?.quantity ?? 0) + line.quantity * part.quantity,
            totalCostCents: (previous?.totalCostCents ?? 0) + cost });
        }
      }
    }
    return [...groups.values()];
  });
  readonly costGroupLabel = (pool: string): string => ({
    base: 'Glicerina base (g)', surfactant: 'Lauril (ml)',
    'fragrance-classic': 'Essências clássicas (ml)', 'fragrance-premium': 'Essências + Aroma (ml)',
    colorant: 'Corantes (ml)',
  } as Record<string, string>)[pool] ?? pool;
  readonly detailItems = computed(() => {
    const items = new Map<string, { productId: string; name: string; quantity: number; costCents: number; pending: boolean; missingCostReason?: string }>();
    for (const entry of this.selectedDay()?.entries ?? []) {
      if (entry.status === 'cancelled') continue;
      for (const part of this.displayItemsFor(entry)) {
        const previous = items.get(part.productId);
        const product = this.catalog.products().find(candidate => candidate.id === part.productId);
        const missingCostReason = part.costPending && product?.categoryId === 'candle'
          ? 'Custo parcial · composição da vela não cadastrada' : undefined;
        if (previous) { previous.quantity += part.quantity; previous.costCents += part.totalCostCents; previous.pending ||= part.costPending; }
        else items.set(part.productId, { productId: part.productId, name: part.productName, quantity: part.quantity, costCents: part.totalCostCents, pending: part.costPending, missingCostReason });
      }
    }
    return [...items.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  });
  readonly detailConsumptions = computed(() => {
    const values = new Map<string, ProductionConsumption>();
    for (const entry of this.selectedDay()?.entries ?? []) {
      if (entry.status === 'cancelled') continue;
      for (const part of entry.consumptions ?? []) {
        const old = values.get(part.inputId);
        if (old) { old.quantity += part.quantity; old.totalCostCents += part.totalCostCents; }
        else values.set(part.inputId, { ...part });
      }
    }
    return [...values.values()];
  });
 readonly filteredDays = computed(() => this.days().filter(day => {
   if (this.filterDate() && day.date !== this.filterDate()) return false;
   if (this.filterCost() === 'partial' && !day.pending) return false;
   if (this.filterCost() === 'complete' && day.pending) return false;
   const text = this.filterProduct().trim().toLocaleLowerCase('pt-BR');
   return !text || day.entries.some(entry => this.itemsFor(entry).some(item =>
     item.productName.toLocaleLowerCase('pt-BR').includes(text)));
 }));
  constructor() {
    this.destroyRef.onDestroy(this.catalog.activate());
    this.destroyRef.onDestroy(this.references.activate());
    this.destroyRef.onDestroy(this.store.activate());
    void Promise.all([this.catalog.load(), this.references.load(), this.store.load()]).then(() => {
      const params = this.route.snapshot.queryParamMap;
      if (params.get('novo') === '1' || params.has('produto')) {
        const productId = params.get('produto') ?? '';
        const date = params.get('data') ?? todayBusinessDate();
        void this.router.navigate([], {
          relativeTo: this.route, queryParams: { novo: null, produto: null, data: null },
          queryParamsHandling: 'merge', replaceUrl: true,
        }).then(() => this.open(productId, date));
      }
    });
  }
  itemsFor(entry: Production): ProductionItem[] { return productionItems(entry); }

  /**
   * Read-only restatement of incomplete legacy costs, based on the current
   * registered reference prices. Never rewrites the original production, its
   * historical sale COGS, inventory movements or payment records.
   */
  displayItemsFor(entry: Production): ProductionItem[] {
    const products = new Map(this.catalog.products().map(item => [item.id, item]));
    const formats = new Map(this.references.formats().map(item => [item.id, item]));
    const collections = new Map(this.references.collections().map(item => [item.id, item]));
    const inputs = new Map(this.catalog.inputs().map(item => [item.id, item]));
    return this.itemsFor(entry).map(item => {
      if (!item.costPending || item.costingModel === 'simplified') return item;
      const product = products.get(item.productId);
      if (!product) return item;
      const format = formats.get(product.formatId);
      if (!format?.soapCostProfile) return item;
      try {
        const cost = standardCostForProduct(product, {
          format, collection: collections.get(product.collectionId),
        }, inputs);
        if (cost.costPending) return {
          ...item, missingCostReferences: cost.missingReferences,
        };
        return {
          ...item,
          unitCostCents: cost.unitCostCents,
          totalCostCents: Math.round(cost.unitCostCents * item.quantity),
          costPending: false,
          costingModel: 'simplified' as const,
          estimatedCosts: cost.estimateLines,
          missingCostReferences: [],
        };
      } catch {
        return item;
      }
    });
  }
 open(productId = '', date = todayBusinessDate()): void { void this.productionEditor().open(productId, date); }
  showDay(date: string): void {
    this.historyEntryId.set('');
    this.selectedHistory.set([]);
    this.selectedDayDate.set(date);
    this.detailDialog().open();
  }

  editEntry(entry: Production): void {
    if (entry.status === 'cancelled') return;
    this.detailDialog().close();
    void this.correctionEditor().open(entry);
  }

  async showHistory(entry: Production): Promise<void> {
    if (this.historyLoading()) return;
    if (this.historyEntryId() === entry.id) {
      this.historyEntryId.set('');
      return;
    }
    this.historyEntryId.set(entry.id);
    this.historyError.set('');
    this.selectedHistory.set([]);
    this.historyLoading.set(true);
    try {
      const history = await this.corrections.history(entry.id);
      if (this.historyEntryId() === entry.id) this.selectedHistory.set(history);
    } catch {
      this.historyError.set('Não foi possível consultar as correções. Tente novamente.');
    } finally {
      this.historyLoading.set(false);
    }
  }

  historyWhen(entry: ProductionCorrectionHistory): string {
    const seconds = (entry.createdAt as { seconds?: number } | undefined)?.seconds;
    return seconds ? new Date(seconds * 1000).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : 'Data indisponível';
  }

  historySummary(entry: ProductionCorrectionHistory): string {
    const before = entry.before.items.reduce((sum, item) => sum + item.quantity, 0);
    const after = entry.kind === 'cancellation' ? 0 : entry.after.items.reduce((sum, item) => sum + item.quantity, 0);
    return before + ' → ' + after + ' unidades';
  }
  inputName(id: string): string { return this.catalog.inputs().find(item => item.id === id)?.name ?? 'Insumo'; }
  unitName(id: string): string { return this.references.units().find(item => item.id === id)?.name ?? ''; }
}
