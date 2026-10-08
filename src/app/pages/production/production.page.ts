import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal, viewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Production, ProductionItem, ProductionConsumption } from '../../domain/models/production.model';
import { CatalogStore } from '../../features/catalog/catalog.store';
import { CatalogReferenceStore } from '../../features/catalog/catalog-reference.store';
import { ProductionStore } from '../../features/production/production.store';
import { BfProductionEditor } from '../../features/production/components/production-editor';
import { todayBusinessDate, formatBusinessDate } from '../../core/utils/date';
import { formatCurrency } from '../../core/utils/money';
import { BfIcon } from '../../shared/ui/icon/icon';
import { BfEmptyState } from '../../shared/ui/empty-state/empty-state';
import { BfDialog } from '../../shared/ui/dialog/dialog';
import { BfSelect, BfSelectOption } from '../../shared/ui/select/select';
import { BfPageRefresh } from '../../shared/feedback/page-refresh/page-refresh';
import { BfTableSkeleton } from '../../shared/ui/skeleton/skeleton';
interface ProductionDay { date: string; entries: Production[]; quantity: number; totalCents: number; pending: boolean; products: number; }
@Component({
 selector: 'bf-production-page',
 imports: [BfIcon, BfDialog, BfEmptyState, BfPageRefresh, BfTableSkeleton, BfProductionEditor, BfSelect],
 changeDetection: ChangeDetectionStrategy.OnPush,
 templateUrl: './production.page.html',
 styleUrl: './production.page.scss',
})
export class ProductionPage {
 readonly catalog = inject(CatalogStore);
 readonly references = inject(CatalogReferenceStore);
 readonly store = inject(ProductionStore);
 private readonly route = inject(ActivatedRoute);
 private readonly router = inject(Router);
 private readonly destroyRef = inject(DestroyRef);
 private readonly productionEditor = viewChild.required<BfProductionEditor>('productionEditor');
 private readonly detailDialog = viewChild.required<BfDialog>('detailDialog');
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
        date: entry.businessDate, entries: [], quantity: 0, totalCents: 0, pending: false, products: 0,
      };
      day.entries.push(entry);
      day.quantity += entry.quantity;
      day.totalCents += entry.totalCostCents;
      day.pending ||= entry.costPending;
      byDate.set(day.date, day);
    }
    for (const day of byDate.values()) day.products = new Set(
      day.entries.flatMap(entry => this.itemsFor(entry).map(item => item.productId))
    ).size;
    return [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date));
  });
  readonly selectedDay = computed(() => this.days().find(day => day.date === this.selectedDayDate()));
  readonly detailItems = computed(() => {
    const items = new Map<string, { productId: string; name: string; quantity: number; costCents: number; pending: boolean }>();
    for (const entry of this.selectedDay()?.entries ?? []) {
      for (const part of this.itemsFor(entry)) {
        const previous = items.get(part.productId);
        if (previous) { previous.quantity += part.quantity; previous.costCents += part.totalCostCents; previous.pending ||= part.costPending; }
        else items.set(part.productId, { productId: part.productId, name: part.productName, quantity: part.quantity, costCents: part.totalCostCents, pending: part.costPending });
      }
    }
    return [...items.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  });
  readonly detailConsumptions = computed(() => {
    const values = new Map<string, ProductionConsumption>();
    for (const entry of this.selectedDay()?.entries ?? []) {
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
  itemsFor(entry: Production): ProductionItem[] {
    return entry.items?.length ? entry.items : [{
      productId: entry.productId, productName: entry.productName, quantity: entry.quantity,
      unitCostCents: entry.unitCostCents, totalCostCents: entry.totalCostCents,
      costPending: entry.costPending, consumptions: entry.consumptions ?? [],
    }];
  }
 open(productId = '', date = todayBusinessDate()): void { void this.productionEditor().open(productId, date); }
  showDay(date: string): void {
    this.selectedDayDate.set(date);
    this.detailDialog().open();
  }
  inputName(id: string): string { return this.catalog.inputs().find(item => item.id === id)?.name ?? 'Insumo'; }
  unitName(id: string): string { return this.references.units().find(item => item.id === id)?.name ?? ''; }
}
