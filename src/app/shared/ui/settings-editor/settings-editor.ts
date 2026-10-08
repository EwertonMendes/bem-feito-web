import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal, viewChild, output } from '@angular/core';
import { FormField, form, min, required } from '@angular/forms/signals';
import { CollectionDefinition, ExpenseCategory, ExpenseType, FormatDefinition, FormatPrice, FragranceDefinition, PaymentMethod, RecipeComponent, UnitDefinition } from '../../../domain/models/catalog.model';
import { CatalogReferenceStore } from '../../../features/catalog/catalog-reference.store';
import { CatalogStore } from '../../../features/catalog/catalog.store';
import { SettingsStore } from '../../../features/settings/settings.store';
import { ToastService } from '../../../core/services/toast.service';
import { ErrorService } from '../../../core/services/error.service';
import { formatCurrency, fromCents, toCents } from '../../../core/utils/money';
import { BfIcon } from '../icon/icon';
import { BfDialog } from '../dialog/dialog';
import { BfSelect, BfSelectOption } from '../select/select';
import { BfCheckbox } from '../checkbox/checkbox';
import { BfNumberInput } from '../number-input/number-input';

export type SettingTab = 'collections' | 'fragrances' | 'formats' | 'prices' | 'units' | 'payments' | 'expenseCategories' | 'expenseTypes';
export type ReferenceSaved = { kind: SettingTab; id: string };
type SimpleSetting = UnitDefinition | PaymentMethod | ExpenseCategory;
interface SimpleModel { name: string; active: boolean; }
interface FragranceModel extends SimpleModel { collectionId: string; }
interface FormatModel extends SimpleModel { approximateWeightGrams: number; }
interface PriceModel { collectionId: string; formatId: string; price: number; active: boolean; }
interface ExpenseTypeModel extends SimpleModel { kind: ExpenseType['kind']; }

@Component({
 selector: 'bf-settings-editor',
 imports: [FormField, BfIcon, BfDialog, BfSelect, BfCheckbox, BfNumberInput],
 changeDetection: ChangeDetectionStrategy.OnPush,
 templateUrl: './settings-editor.html',
 styleUrl: './settings-editor.scss'
})
export class BfSettingsEditor {
  readonly saved = output<ReferenceSaved>();
  readonly references = inject(CatalogReferenceStore);
  readonly catalog = inject(CatalogStore);
  readonly settings = inject(SettingsStore);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly errors = inject(ErrorService);
  private readonly dialog = viewChild.required<BfDialog>('editor');

  readonly currency = formatCurrency;
  readonly tab = signal<SettingTab>('collections');
  readonly initialized = computed(() => this.references.initialized() && this.catalog.initialized() && this.settings.initialized());
  readonly refreshing = computed(() => this.initialized() && (this.references.loading() || this.catalog.loading() || this.settings.loading()));
  readonly editingId = signal('');
  readonly costComponents = signal<RecipeComponent[]>([]);
  readonly simpleModel = signal<SimpleModel>({ name: '', active: true });
  readonly simpleForm = form(this.simpleModel, (p) => required(p.name));
  readonly fragranceModel = signal<FragranceModel>({ name: '', collectionId: '', active: true });
  readonly fragranceForm = form(this.fragranceModel, (p) => { required(p.name); required(p.collectionId); });
  readonly formatModel = signal<FormatModel>({ name: '', approximateWeightGrams: 0, active: true });
  readonly formatForm = form(this.formatModel, (p) => { required(p.name); min(p.approximateWeightGrams, 0); });
  readonly priceModel = signal<PriceModel>({ collectionId: '', formatId: '', price: 0, active: true });
  readonly priceForm = form(this.priceModel, (p) => { required(p.collectionId); required(p.formatId); min(p.price, 0); });
  readonly expenseTypeModel = signal<ExpenseTypeModel>({ name: '', kind: 'operating-expense', active: true });
  readonly expenseTypeForm = form(this.expenseTypeModel, (p) => { required(p.name); required(p.kind); });

  readonly collectionOptions = computed<BfSelectOption[]>(() => [
    { value: '', label: 'Selecione' },
    ...this.references.collections().map((item) => ({ value: item.id, label: item.name })),
  ]);
  readonly formatOptions = computed<BfSelectOption[]>(() => [
    { value: '', label: 'Selecione' },
    ...this.references.formats().map((item) => ({ value: item.id, label: item.name })),
  ]);
  readonly costInputOptions = computed<BfSelectOption[]>(() => [
    { value: '', label: 'Selecione' },
    ...this.catalog.activeInputs().map((item) => ({ value: item.id, label: item.name })),
  ]);
  readonly expenseTypeOptions: readonly BfSelectOption[] = [
    { value: 'input-purchase', label: 'Compra de insumo', icon: 'purchase' },
    { value: 'operating-expense', label: 'Despesa operacional', icon: 'expense' },
    { value: 'equipment', label: 'Equipamento / investimento', icon: 'equipment' },
    { value: 'other', label: 'Outro', icon: 'other-expense' },
  ];

  constructor() {
    this.destroyRef.onDestroy(this.references.activate());
    this.destroyRef.onDestroy(this.catalog.activate());
    this.destroyRef.onDestroy(this.settings.activate());
    void Promise.all([this.references.load(), this.catalog.load(), this.settings.load()]);
  }

  openNew(kind: SettingTab = this.tab(), collectionId = ''): void {
    this.tab.set(kind);
    this.editingId.set('');
    this.costComponents.set([]);
    this.simpleModel.set({ name: '', active: true });
    this.fragranceModel.set({ name: '', collectionId, active: true });
    this.formatModel.set({ name: '', approximateWeightGrams: 0, active: true });
    this.priceModel.set({ collectionId: '', formatId: '', price: 0, active: true });
    this.expenseTypeModel.set({ name: '', kind: 'operating-expense', active: true });
    this.dialog().open();
  }

  editCollection(item: CollectionDefinition): void {
    this.tab.set('collections');
    this.editingId.set(item.id);
    this.simpleModel.set({ name: item.name, active: item.active });
    this.costComponents.set((item.costComponents ?? []).map((component) => ({ ...component })));
    this.dialog().open();
  }

  editSimple(item: SimpleSetting, kind: SettingTab = this.tab()): void {
    this.tab.set(kind);
    this.editingId.set(item.id);
    this.costComponents.set([]);
    this.simpleModel.set({ name: item.name, active: item.active });
    this.dialog().open();
  }

  editFragrance(item: FragranceDefinition): void {
    this.tab.set('fragrances');
    this.editingId.set(item.id);
    this.fragranceModel.set({ name: item.name, collectionId: item.collectionId, active: item.active });
    this.costComponents.set((item.costComponents ?? []).map((component) => ({ ...component })));
    this.dialog().open();
  }

  editFormat(item: FormatDefinition): void {
    this.tab.set('formats');
    this.editingId.set(item.id);
    this.formatModel.set({ name: item.name, approximateWeightGrams: item.approximateWeightGrams ?? 0, active: item.active });
    this.costComponents.set((item.costComponents ?? []).map((component) => ({ ...component })));
    this.dialog().open();
  }

  editPrice(item: FormatPrice): void {
    this.tab.set('prices');
    this.editingId.set(item.id);
    this.costComponents.set([]);
    this.priceModel.set({ collectionId: item.collectionId, formatId: item.formatId, price: fromCents(item.priceCents), active: item.active });
    this.dialog().open();
  }

  editExpenseType(item: ExpenseType): void {
    this.tab.set('expenseTypes');
    this.editingId.set(item.id);
    this.costComponents.set([]);
    this.expenseTypeModel.set({ name: item.name, kind: item.kind, active: item.active });
    this.dialog().open();
  }

  addCostComponent(): void {
    const input = this.catalog.activeInputs()[0];
    if (!input) return;
    this.costComponents.update((items) => [...items, { inputId: input.id, quantity: 0, unitId: input.unitId }]);
  }

  selectCostInput(index: number, inputId: string): void {
    const input = this.catalog.inputs().find((item) => item.id === inputId);
    this.patchCostComponent(index, { inputId, unitId: input?.unitId ?? '' });
  }

  patchCostComponent(index: number, patch: Partial<RecipeComponent>): void {
    this.costComponents.update((items) => items.map((item, i) => i === index ? { ...item, ...patch } : item));
  }

  removeCostComponent(index: number): void {
    this.costComponents.update((items) => items.filter((_, i) => i !== index));
  }

  unitName(unitId: string): string {
    return this.references.units().find((item) => item.id === unitId)?.name ?? '—';
  }

  componentUnitCostLabel(component: RecipeComponent): string {
    const input = this.catalog.inputs().find((item) => item.id === component.inputId);
    if (!input || input.averageUnitCostCents <= 0) return 'Custo pendente';
    return `${this.currency(input.averageUnitCostCents)}/${this.unitName(component.unitId)}`;
  }

  componentTotalCostLabel(component: RecipeComponent): string {
    const input = this.catalog.inputs().find((item) => item.id === component.inputId);
    if (!input || input.averageUnitCostCents <= 0) return 'Pendente';
    return this.currency(Math.round(component.quantity * input.averageUnitCostCents));
  }

  costSummary(components: readonly RecipeComponent[] | undefined): string {
    const items = (components ?? []).filter((item) => item.inputId && item.quantity > 0 && item.unitId);
    if (!items.length) return 'Sem padrão';

    let totalCents = 0;
    let pending = 0;
    for (const component of items) {
      const input = this.catalog.inputs().find((item) => item.id === component.inputId);
      if (!input || input.averageUnitCostCents <= 0) {
        pending += 1;
        continue;
      }
      totalCents += Math.round(component.quantity * input.averageUnitCostCents);
    }

    const count = `${items.length} componente${items.length === 1 ? '' : 's'}`;
    if (pending) return `${count} · ${this.currency(totalCents)} + ${pending} pendente${pending === 1 ? '' : 's'}`;
    return `${count} · ${this.currency(totalCents)}`;
  }

  currentCostSummary(): string {
    return this.costSummary(this.costComponents());
  }

  costScopeHint(): string {
    if (this.tab() === 'formats') return 'Aplicado a todo produto deste formato. Bom para base, peso padrão e materiais comuns.';
    if (this.tab() === 'fragrances') return 'Aplicado a todo produto desta fragrância. Bom para essência e corantes específicos.';
    return 'Aplicado a todo produto desta coleção. Use para componentes comuns à linha.';
  }

  async save(): Promise<void> {
    try {
      const id = this.editingId();
      let savedId = id;
      const costComponents = this.costComponents().filter((item) => item.inputId && item.quantity > 0 && item.unitId);
      if (this.tab() === 'collections') {
        savedId = await this.references.saveCollection({ id, ...this.simpleModel(), costComponents } as CollectionDefinition);
      } else if (this.tab() === 'fragrances') {
        savedId = await this.references.saveFragrance({ id, ...this.fragranceModel(), costComponents } as FragranceDefinition);
      } else if (this.tab() === 'formats') {
        savedId = await this.references.saveFormat({ id, ...this.formatModel(), costComponents } as FormatDefinition);
      } else if (this.tab() === 'prices') {
        const model = this.priceModel();
        await this.references.saveFormatPrice({ id, collectionId: model.collectionId, formatId: model.formatId, priceCents: toCents(model.price), active: model.active } as FormatPrice);
      } else if (this.tab() === 'units') await this.references.saveUnit({ id, ...this.simpleModel() } as UnitDefinition);
      else if (this.tab() === 'payments') await this.settings.savePaymentMethod({ id, ...this.simpleModel() } as PaymentMethod);
      else if (this.tab() === 'expenseCategories') await this.settings.saveExpenseCategory({ id, ...this.simpleModel() } as ExpenseCategory);
      else await this.settings.saveExpenseType({ id, ...this.expenseTypeModel() } as ExpenseType);
      this.toast.success('Configuração salva.');
      this.dialog().close();
      this.saved.emit({ kind: this.tab(), id: savedId });
    } catch (error) {
      this.toast.error(this.errors.message(error));
    }
  }

  collectionName(id: string): string {
    return this.references.collections().find((item) => item.id === id)?.name ?? '—';
  }

  formatName(id: string): string {
    return this.references.formats().find((item) => item.id === id)?.name ?? '—';
  }
}
