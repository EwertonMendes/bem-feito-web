import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal, viewChild } from '@angular/core';
import { CollectionDefinition, ExpenseCategory, ExpenseType, FormatDefinition, FormatPrice, FragranceDefinition, PaymentMethod, UnitDefinition } from '../../domain/models/catalog.model';
import { CatalogReferenceStore } from '../../features/catalog/catalog-reference.store';
import { CatalogStore } from '../../features/catalog/catalog.store';
import { SettingsStore } from '../../features/settings/settings.store';
import { BfIcon } from '../../shared/ui/icon/icon';
import { BfPageRefresh } from '../../shared/feedback/page-refresh/page-refresh';
import { BfTableSkeleton } from '../../shared/ui/skeleton/skeleton';
import { GoogleDriveSettingsCard } from '../../features/google-drive/components/google-drive-settings-card';
import { BfSettingsEditor, SettingTab } from '../../shared/ui/settings-editor/settings-editor';

@Component({
 selector: 'bf-settings-page',
 imports: [BfIcon, BfPageRefresh, BfTableSkeleton, GoogleDriveSettingsCard, BfSettingsEditor],
 changeDetection: ChangeDetectionStrategy.OnPush,
 templateUrl: './settings.page.html',
 styleUrl: './settings.page.scss',
})
export class SettingsPage {
 readonly references = inject(CatalogReferenceStore);
 readonly catalog = inject(CatalogStore);
 readonly settings = inject(SettingsStore);
 private readonly destroyRef = inject(DestroyRef);
 private readonly editor = viewChild.required<BfSettingsEditor>('editor');
 readonly tab = signal<SettingTab>('collections');
 readonly initialized = computed(() => this.references.initialized() && this.catalog.initialized() && this.settings.initialized());
 readonly refreshing = computed(() => this.initialized() && (this.references.loading() || this.catalog.loading() || this.settings.loading()));
 constructor() {
  this.destroyRef.onDestroy(this.references.activate());
  this.destroyRef.onDestroy(this.catalog.activate());
  this.destroyRef.onDestroy(this.settings.activate());
  void Promise.all([this.references.load(), this.catalog.load(), this.settings.load()]);
 }
 openNew(): void { this.editor().openNew(this.tab()); }
 editCollection(item: CollectionDefinition): void { this.editor().editCollection(item); }
 editFragrance(item: FragranceDefinition): void { this.editor().editFragrance(item); }
 editFormat(item: FormatDefinition): void { this.editor().editFormat(item); }
 editPrice(item: FormatPrice): void { this.editor().editPrice(item); }
 editSimple(item: UnitDefinition | PaymentMethod | ExpenseCategory): void { this.editor().editSimple(item, this.tab()); }
 editExpenseType(item: ExpenseType): void { this.editor().editExpenseType(item); }
 collectionName(id: string): string { return this.references.collections().find(x => x.id === id)?.name ?? '—'; }
 formatName(id: string): string { return this.references.formats().find(x => x.id === id)?.name ?? '—'; }
 costSummary(components: CollectionDefinition['costComponents']): string {
   const values = (components ?? []).filter(x => x.inputId && x.quantity > 0 && x.unitId);
   if (!values.length) return 'Sem padrão';
   let total = 0, pending = 0;
   for (const part of values) {
     const input = this.catalog.inputs().find(x => x.id === part.inputId);
     if (!input || input.averageUnitCostCents <= 0) pending++;
     else total += Math.round(part.quantity * input.averageUnitCostCents);
   }
   const amount = new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(total / 100);
   return `${values.length} componente${values.length === 1 ? '' : 's'} · ${amount}${pending ? ' + ' + pending + ' pendente(s)' : ''}`;
 }
}
