import { ChangeDetectionStrategy, Component, ElementRef, inject, signal, viewChild } from '@angular/core';
import { FormField, form, min, required } from '@angular/forms/signals';
import {
  CollectionDefinition,
  ExpenseCategory,
  ExpenseType,
  FormatDefinition,
  FormatPrice,
  FragranceDefinition,
  PaymentMethod,
  UnitDefinition,
} from '../../domain/models/catalog.model';
import { CatalogStore } from '../../features/catalog/catalog.store';
import { SettingsStore } from '../../features/settings/settings.store';
import { ToastService } from '../../core/services/toast.service';
import { ErrorService } from '../../core/services/error.service';
import { fromCents, toCents } from '../../core/utils/money';
import { BfIcon } from '../../shared/ui/icon/icon';
import { GoogleDriveSettingsCard } from '../../features/google-drive/components/google-drive-settings-card';

type SettingTab = 'collections' | 'fragrances' | 'formats' | 'prices' | 'units' | 'payments' | 'expenseCategories' | 'expenseTypes';
type SimpleSetting = CollectionDefinition | UnitDefinition | PaymentMethod | ExpenseCategory;

interface SimpleModel { name: string; active: boolean; }
interface FragranceModel extends SimpleModel { collectionId: string; }
interface FormatModel extends SimpleModel { approximateWeightGrams: number; }
interface PriceModel { collectionId: string; formatId: string; price: number; active: boolean; }
interface ExpenseTypeModel extends SimpleModel { kind: ExpenseType['kind']; }

@Component({
  selector: 'bf-settings-page',
  imports: [FormField, BfIcon, GoogleDriveSettingsCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './settings.page.html',
  styleUrl: './settings.page.scss',
})
export class SettingsPage {
  readonly catalog = inject(CatalogStore);
  readonly settings = inject(SettingsStore);
  private readonly toast = inject(ToastService);
  private readonly errors = inject(ErrorService);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('editor');

  readonly tab = signal<SettingTab>('collections');
  readonly editingId = signal('');
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

  constructor() {
    void Promise.all([this.catalog.load(), this.settings.load()]);
  }

  openNew(): void {
    this.editingId.set('');
    this.simpleModel.set({ name: '', active: true });
    this.fragranceModel.set({ name: '', collectionId: '', active: true });
    this.formatModel.set({ name: '', approximateWeightGrams: 0, active: true });
    this.priceModel.set({ collectionId: '', formatId: '', price: 0, active: true });
    this.expenseTypeModel.set({ name: '', kind: 'operating-expense', active: true });
    this.dialog().nativeElement.showModal();
  }

  editSimple(item: SimpleSetting): void {
    this.editingId.set(item.id);
    this.simpleModel.set({ name: item.name, active: item.active });
    this.dialog().nativeElement.showModal();
  }

  editFragrance(item: FragranceDefinition): void {
    this.editingId.set(item.id);
    this.fragranceModel.set({ name: item.name, collectionId: item.collectionId, active: item.active });
    this.dialog().nativeElement.showModal();
  }

  editFormat(item: FormatDefinition): void {
    this.editingId.set(item.id);
    this.formatModel.set({ name: item.name, approximateWeightGrams: item.approximateWeightGrams ?? 0, active: item.active });
    this.dialog().nativeElement.showModal();
  }

  editPrice(item: FormatPrice): void {
    this.editingId.set(item.id);
    this.priceModel.set({ collectionId: item.collectionId, formatId: item.formatId, price: fromCents(item.priceCents), active: item.active });
    this.dialog().nativeElement.showModal();
  }

  editExpenseType(item: ExpenseType): void {
    this.editingId.set(item.id);
    this.expenseTypeModel.set({ name: item.name, kind: item.kind, active: item.active });
    this.dialog().nativeElement.showModal();
  }

  async save(): Promise<void> {
    try {
      const id = this.editingId();
      if (this.tab() === 'collections') await this.catalog.saveCollection({ id, ...this.simpleModel() } as CollectionDefinition);
      else if (this.tab() === 'fragrances') await this.catalog.saveFragrance({ id, ...this.fragranceModel() } as FragranceDefinition);
      else if (this.tab() === 'formats') await this.catalog.saveFormat({ id, ...this.formatModel() } as FormatDefinition);
      else if (this.tab() === 'prices') {
        const model = this.priceModel();
        await this.catalog.saveFormatPrice({ id, collectionId: model.collectionId, formatId: model.formatId, priceCents: toCents(model.price), active: model.active } as FormatPrice);
      } else if (this.tab() === 'units') await this.catalog.saveUnit({ id, ...this.simpleModel() } as UnitDefinition);
      else if (this.tab() === 'payments') await this.settings.savePaymentMethod({ id, ...this.simpleModel() } as PaymentMethod);
      else if (this.tab() === 'expenseCategories') await this.settings.saveExpenseCategory({ id, ...this.simpleModel() } as ExpenseCategory);
      else await this.settings.saveExpenseType({ id, ...this.expenseTypeModel() } as ExpenseType);
      this.toast.success('Configuração salva.');
      this.dialog().nativeElement.close();
    } catch (error) {
      this.toast.error(this.errors.message(error));
    }
  }

  collectionName(id: string): string {
    return this.catalog.collections().find((item) => item.id === id)?.name ?? '—';
  }

  formatName(id: string): string {
    return this.catalog.formats().find((item) => item.id === id)?.name ?? '—';
  }
}
