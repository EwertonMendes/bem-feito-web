import { ChangeDetectionStrategy, Component, computed, inject, signal, viewChild } from '@angular/core';
import { FormField, form, min, required } from '@angular/forms/signals';
import { Addition, AdditionComponent, InputItem, Kit, KitComponent, Product, RecipeComponent } from '../../../../domain/models/catalog.model';
import { CatalogImageEntityKind, CatalogImageRef } from '../../../../domain/models/image.model';
import { ErrorService } from '../../../../core/services/error.service';
import { ImageService } from '../../../../core/services/image.service';
import { ToastService } from '../../../../core/services/toast.service';
import { fromCents, toCents } from '../../../../core/utils/money';
import { CatalogReferenceStore } from '../../catalog-reference.store';
import { CatalogStore } from '../../catalog.store';
import { BfDialog } from '../../../../shared/ui/dialog/dialog';
import { BfIcon } from '../../../../shared/ui/icon/icon';

interface ProductFormModel { code: string; collectionId: string; fragranceId: string; formatId: string; salePrice: number; additionalCost: number; minimumStock: number; active: boolean; }
interface InputFormModel { code: string; name: string; unitId: string; minimumStock: number | null; active: boolean; }
interface KitFormModel { name: string; price: number; notes: string; active: boolean; }
interface AdditionFormModel { name: string; category: string; price: number; notes: string; active: boolean; }

@Component({
  selector: 'bf-catalog-editor',
  imports: [FormField, BfDialog, BfIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './catalog-editor.html',
  styleUrl: './catalog-editor.scss',
})
export class CatalogEditor {
  readonly store = inject(CatalogStore);
  readonly references = inject(CatalogReferenceStore);
  private readonly images = inject(ImageService);
  private readonly toast = inject(ToastService);
  private readonly errors = inject(ErrorService);
  private readonly dialog = viewChild.required<BfDialog>('dialog');

  readonly imagesEnabled = this.images.enabled;
  readonly kind = signal<CatalogImageEntityKind>('products');
  readonly editingId = signal('');
  readonly imageFile = signal<File | null>(null);
  readonly removeImage = signal(false);
  readonly recipe = signal<RecipeComponent[]>([]);
  readonly kitComponents = signal<KitComponent[]>([]);
  readonly additionComponents = signal<AdditionComponent[]>([]);

  readonly currentImage = computed<CatalogImageRef | undefined>(() => {
    const id = this.editingId();
    if (!id) return undefined;
    if (this.kind() === 'products') return this.store.products().find((item) => item.id === id)?.image;
    if (this.kind() === 'inputs') return this.store.inputs().find((item) => item.id === id)?.image;
    if (this.kind() === 'kits') return this.store.kits().find((item) => item.id === id)?.image;
    return this.store.additions().find((item) => item.id === id)?.image;
  });

  readonly productModel = signal<ProductFormModel>({ code: '', collectionId: '', fragranceId: '', formatId: '', salePrice: 0, additionalCost: 0, minimumStock: 0, active: true });
  readonly productForm = form(this.productModel, (p) => {
    required(p.code, { message: 'Informe o código.' });
    required(p.collectionId, { message: 'Selecione a coleção.' });
    required(p.fragranceId, { message: 'Selecione a fragrância.' });
    required(p.formatId, { message: 'Selecione o formato.' });
    min(p.salePrice, 0);
    min(p.minimumStock, 0);
  });

  readonly inputModel = signal<InputFormModel>({ code: '', name: '', unitId: '', minimumStock: 0, active: true });
  readonly inputForm = form(this.inputModel, (p) => {
    required(p.code);
    required(p.name);
    required(p.unitId);
    min(p.minimumStock, 0);
  });

  readonly kitModel = signal<KitFormModel>({ name: '', price: 0, notes: '', active: true });
  readonly kitForm = form(this.kitModel, (p) => { required(p.name); min(p.price, 0); });
  readonly additionModel = signal<AdditionFormModel>({ name: '', category: 'Embalagem', price: 0, notes: '', active: true });
  readonly additionForm = form(this.additionModel, (p) => { required(p.name); required(p.category); min(p.price, 0); });
  readonly availableFragrances = computed(() => this.references.fragrances().filter((item) => item.active && (!this.productModel().collectionId || item.collectionId === this.productModel().collectionId)));

  constructor() {
    void Promise.all([this.store.load(), this.references.load()]);
  }

  openNew(kind: CatalogImageEntityKind): void {
    this.kind.set(kind);
    this.editingId.set('');
    this.resetImageChange();
    if (kind === 'products') {
      this.productModel.set({ code: '', collectionId: '', fragranceId: '', formatId: '', salePrice: 0, additionalCost: 0, minimumStock: 0, active: true });
      this.recipe.set([]);
    } else if (kind === 'inputs') {
      this.inputModel.set({ code: '', name: '', unitId: '', minimumStock: 0, active: true });
    } else if (kind === 'kits') {
      this.kitModel.set({ name: '', price: 0, notes: '', active: true });
      this.kitComponents.set([]);
    } else {
      this.additionModel.set({ name: '', category: 'Embalagem', price: 0, notes: '', active: true });
      this.additionComponents.set([]);
    }
    this.dialog().open();
  }

  editProduct(item: Product): void {
    this.kind.set('products');
    this.editingId.set(item.id);
    this.resetImageChange();
    this.productModel.set({ code: item.code, collectionId: item.collectionId, fragranceId: item.fragranceId, formatId: item.formatId, salePrice: fromCents(item.salePriceCents), additionalCost: fromCents(item.additionalCostCents), minimumStock: item.minimumStock, active: item.active });
    this.recipe.set(item.recipe.map((component) => ({ ...component })));
    this.dialog().open();
  }

  editInput(item: InputItem): void {
    this.kind.set('inputs');
    this.editingId.set(item.id);
    this.resetImageChange();
    this.inputModel.set({ code: item.code, name: item.name, unitId: item.unitId, minimumStock: item.minimumStockConfigured === false ? null : item.minimumStock, active: item.active });
    this.dialog().open();
  }

  editKit(item: Kit): void {
    this.kind.set('kits');
    this.editingId.set(item.id);
    this.resetImageChange();
    this.kitModel.set({ name: item.name, price: fromCents(item.priceCents), notes: item.notes ?? '', active: item.active });
    this.kitComponents.set(item.components.map((component) => ({ ...component })));
    this.dialog().open();
  }

  editAddition(item: Addition): void {
    this.kind.set('additions');
    this.editingId.set(item.id);
    this.resetImageChange();
    this.additionModel.set({ name: item.name, category: item.category, price: fromCents(item.priceCents), notes: item.notes ?? '', active: item.active });
    this.additionComponents.set(item.components.map((component) => ({ ...component })));
    this.dialog().open();
  }

  addRecipeComponent(): void {
    const input = this.store.activeInputs()[0];
    const unit = this.references.units()[0];
    if (input && unit) this.recipe.update((items) => [...items, { inputId: input.id, quantity: 0, unitId: unit.id }]);
  }

  patchRecipe(index: number, patch: Partial<RecipeComponent>): void {
    this.recipe.update((items) => items.map((item, i) => i === index ? { ...item, ...patch } : item));
  }

  removeRecipe(index: number): void {
    this.recipe.update((items) => items.filter((_, i) => i !== index));
  }

  addKitComponent(): void {
    const format = this.references.formats().find((item) => item.active);
    if (format) this.kitComponents.update((items) => [...items, { id: crypto.randomUUID(), formatId: format.id, quantity: 1, order: items.length + 1 }]);
  }

  patchKitComponent(index: number, patch: Partial<KitComponent>): void {
    this.kitComponents.update((items) => items.map((item, i) => i === index ? { ...item, ...patch } : item));
  }

  removeKitComponent(index: number): void {
    this.kitComponents.update((items) => items.filter((_, i) => i !== index).map((item, i) => ({ ...item, order: i + 1 })));
  }

  addAdditionComponent(): void {
    const input = this.store.activeInputs()[0];
    const unit = this.references.units()[0];
    if (input && unit) this.additionComponents.update((items) => [...items, { id: crypto.randomUUID(), inputId: input.id, quantity: 1, unitId: unit.id, order: items.length + 1 }]);
  }

  patchAdditionComponent(index: number, patch: Partial<AdditionComponent>): void {
    this.additionComponents.update((items) => items.map((item, i) => i === index ? { ...item, ...patch } : item));
  }

  removeAdditionComponent(index: number): void {
    this.additionComponents.update((items) => items.filter((_, i) => i !== index).map((item, i) => ({ ...item, order: i + 1 })));
  }

  onImage(event: Event): void {
    if (!this.imagesEnabled) return;
    const files = (event.target as HTMLInputElement).files;
    this.imageFile.set(files?.[0] ?? null);
    if (files?.length) this.removeImage.set(false);
  }

  markImageForRemoval(): void {
    this.imageFile.set(null);
    this.removeImage.set(true);
  }

  async save(): Promise<void> {
    try {
      if (this.kind() === 'products') await this.saveProduct();
      else if (this.kind() === 'inputs') await this.saveInput();
      else if (this.kind() === 'kits') await this.saveKit();
      else await this.saveAddition();
      this.toast.success('Cadastro salvo com sucesso.');
      this.dialog().close();
    } catch (error) {
      this.toast.error(this.errors.message(error));
    }
  }

  private async saveProduct(): Promise<void> {
    if (this.productForm().invalid()) throw new Error('Revise os campos obrigatórios.');
    const model = this.productModel();
    const collection = this.references.collections().find((item) => item.id === model.collectionId);
    const fragrance = this.references.fragrances().find((item) => item.id === model.fragranceId);
    const format = this.references.formats().find((item) => item.id === model.formatId);
    if (!collection || !fragrance || !format) throw new Error('Coleção, fragrância ou formato inválido.');
    const existing = this.store.products().find((item) => item.id === this.editingId());
    const product: Product = {
      id: existing?.id ?? '', code: model.code.trim(), active: model.active, collectionId: model.collectionId,
      fragranceId: model.fragranceId, formatId: model.formatId, displayName: `${collection.name} · ${fragrance.name} · ${format.name}`,
      salePriceCents: toCents(model.salePrice), additionalCostCents: toCents(model.additionalCost), averageUnitCostCents: existing?.averageUnitCostCents ?? 0,
      stock: existing?.stock ?? 0, minimumStock: model.minimumStock, image: existing?.image,
      recipe: this.recipe().filter((item) => item.inputId && item.quantity > 0 && item.unitId),
    };
    const id = await this.store.saveProduct(product, !this.hasImageChange());
    await this.applyImageChange('products', id, existing?.image, (image) => this.store.setProductImage(id, image));
  }

  private async saveInput(): Promise<void> {
    if (this.inputForm().invalid()) throw new Error('Revise os campos obrigatórios.');
    const model = this.inputModel();
    const existing = this.store.inputs().find((item) => item.id === this.editingId());
    const input: InputItem = {
      id: existing?.id ?? '', code: model.code.trim(), active: model.active, name: model.name.trim(), unitId: model.unitId,
      stock: existing?.stock ?? 0, minimumStock: model.minimumStock ?? 0, minimumStockConfigured: model.minimumStock !== null,
      averageUnitCostCents: existing?.averageUnitCostCents ?? 0, image: existing?.image,
    };
    const id = await this.store.saveInput(input, !this.hasImageChange());
    await this.applyImageChange('inputs', id, existing?.image, (image) => this.store.setInputImage(id, image));
  }

  private async saveKit(): Promise<void> {
    if (this.kitForm().invalid()) throw new Error('Revise os campos obrigatórios.');
    if (!this.kitComponents().length) throw new Error('Adicione pelo menos um componente ao kit.');
    const model = this.kitModel();
    const existing = this.store.kits().find((item) => item.id === this.editingId());
    const kit: Kit = {
      id: existing?.id ?? '', active: model.active, name: model.name.trim(), priceCents: toCents(model.price),
      notes: model.notes.trim() || undefined, image: existing?.image,
      components: this.kitComponents().filter((item) => item.formatId && item.quantity > 0),
    };
    const id = await this.store.saveKit(kit, !this.hasImageChange());
    await this.applyImageChange('kits', id, existing?.image, (image) => this.store.setKitImage(id, image));
  }

  private async saveAddition(): Promise<void> {
    if (this.additionForm().invalid()) throw new Error('Revise os campos obrigatórios.');
    const model = this.additionModel();
    const existing = this.store.additions().find((item) => item.id === this.editingId());
    const addition: Addition = {
      id: existing?.id ?? '', active: model.active, name: model.name.trim(), category: model.category.trim(), priceCents: toCents(model.price),
      notes: model.notes.trim() || undefined, image: existing?.image,
      components: this.additionComponents().filter((item) => item.inputId && item.quantity > 0 && item.unitId),
    };
    const id = await this.store.saveAddition(addition, !this.hasImageChange());
    await this.applyImageChange('additions', id, existing?.image, (image) => this.store.setAdditionImage(id, image));
  }

  private async applyImageChange(
    kind: CatalogImageEntityKind,
    id: string,
    existing: CatalogImageRef | undefined,
    persist: (image: CatalogImageRef | null) => Promise<void>,
  ): Promise<void> {
    const file = this.imageFile();
    if (file) {
      const image = await this.images.saveCatalogImage(kind, id, file, existing);
      await persist(image);
      return;
    }
    if (this.removeImage() && existing) {
      await persist(null);
      await this.images.removeCatalogImage(kind, id, existing);
    }
  }

  private hasImageChange(): boolean {
    return Boolean(this.imageFile()) || this.removeImage();
  }

  private resetImageChange(): void {
    this.imageFile.set(null);
    this.removeImage.set(false);
  }
}
