import { BfLoadingButton } from '../../../../shared/ui/button/loading-button';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal, viewChild } from '@angular/core';
import { FormField, form, min, required } from '@angular/forms/signals';
import { Addition, AdditionComponent, InputItem, InputTrackingMode, Product, RecipeComponent } from '../../../../domain/models/catalog.model';
import { standardCostForProduct, trackingModeForInput } from '../../../../domain/logic/costing';
import { PRODUCT_CATEGORIES, productCategoryId, productIdentity } from '../../../../domain/logic/product-category';
import { CatalogImageEntityKind, CatalogImageRef } from '../../../../domain/models/image.model';
import { ErrorService } from '../../../../core/services/error.service';
import { ImageService } from '../../../../core/services/image.service';
import { ToastService } from '../../../../core/services/toast.service';
import { formatCurrency, fromCents, toCents } from '../../../../core/utils/money';
import { CatalogReferenceStore } from '../../catalog-reference.store';
import { CatalogStore } from '../../catalog.store';
import { BfDialog } from '../../../../shared/ui/dialog/dialog';
import { BfSettingsEditor, ReferenceSaved } from '../../../settings/editor/settings-editor';
import { BfIcon } from '../../../../shared/ui/icon/icon';
import { BfSelect, BfSelectOption } from '../../../../shared/ui/select/select';
import { BfSelectSearch } from '../../../../shared/ui/select-search/select-search';
import { BfCheckbox } from '../../../../shared/ui/checkbox/checkbox';
import { BfImageUpload } from '../../../../shared/ui/image-upload/image-upload';
import { CatalogImage } from '../../../../shared/media/catalog-image/catalog-image';
import { BfNumberInput } from '../../../../shared/ui/number-input/number-input';
import { SoapCreationForm } from '../soap-creation-form/soap-creation-form';

interface ProductFormModel { categoryId: 'soap' | 'creative-kit' | 'scented-candle'; modelName: string; variantName: string; description: string; volumeMl: number; collectionId: string; fragranceId: string; formatId: string; salePrice: number; additionalCost: number; minimumStock: number; active: boolean; }
interface InputFormModel { name: string; unitId: string; trackingMode: InputTrackingMode; availabilityStatus: string; minimumStock: number; active: boolean; }
interface AdditionFormModel { name: string; category: string; price: number; notes: string; active: boolean; }

@Component({
  selector: 'bf-catalog-editor',
  imports: [BfLoadingButton, FormField, BfDialog, BfIcon, BfSelect, BfSelectSearch, CatalogImage, BfCheckbox, BfImageUpload, CatalogImage, BfNumberInput, BfSettingsEditor, SoapCreationForm],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './catalog-editor.html',
  styleUrl: './catalog-editor.scss',
})
export class CatalogEditor {
  readonly store = inject(CatalogStore);
  readonly references = inject(CatalogReferenceStore);
  private readonly destroyRef = inject(DestroyRef);
  private readonly images = inject(ImageService);
  private readonly toast = inject(ToastService);
  private readonly errors = inject(ErrorService);
  private readonly dialog = viewChild.required<BfDialog>('dialog');
  private readonly referenceEditor = viewChild.required<BfSettingsEditor>('referenceEditor');
  readonly soapCreator = viewChild<SoapCreationForm>('soapCreator');
  readonly isCreatingSoap = computed(() => this.kind() === 'products' && !this.editingId() && this.productModel().categoryId === 'soap');

  readonly currency = formatCurrency;
  readonly imagesEnabled = this.images.enabled;
  readonly kind = signal<CatalogImageEntityKind>('products');
  readonly suggestedPrice = computed(() => {
    const model = this.productModel();
    if (model.categoryId !== 'soap') return undefined;
    return this.references.formatPrices().find(item =>
      item.active && item.collectionId === model.collectionId && item.formatId === model.formatId);
  });
  applySuggestedPrice(): void {
    const price = this.suggestedPrice();
    if (price) this.productModel.update(model => ({ ...model, salePrice: fromCents(price.priceCents) }));
  }
  openQuickReference(kind: 'collection' | 'fragrance' | 'format'): void {
    const collectionId = this.isCreatingSoap() ? (this.soapCreator()?.collectionId() ?? '') : this.productModel().collectionId;
    if (kind === 'fragrance' && !collectionId) {
      this.toast.error('Selecione ou crie uma coleção antes da fragrância.');
      return;
    }
    this.referenceEditor().openNew(
      kind === 'collection' ? 'collections' : kind === 'fragrance' ? 'fragrances' : 'formats',
      collectionId,
    );
  }

  onReferenceSaved(event: ReferenceSaved): void {
    if (!event.id) return;
    if (this.isCreatingSoap() && (event.kind === 'collections' || event.kind === 'fragrances' || event.kind === 'formats')) {
      this.soapCreator()?.onReferenceSaved(event.kind, event.id);
      return;
    }
    if (event.kind === 'collections') this.productModel.update(model => ({ ...model, collectionId: event.id, fragranceId: '' }));
    if (event.kind === 'fragrances') this.productModel.update(model => ({ ...model, fragranceId: event.id }));
    if (event.kind === 'formats') this.productModel.update(model => ({ ...model, formatId: event.id }));
  }

  readonly saving = signal(false);
  readonly editingId = signal('');
  readonly imageFile = signal<File | null>(null);
  readonly removeImage = signal(false);
  readonly recipe = signal<RecipeComponent[]>([]);
  readonly additionComponents = signal<AdditionComponent[]>([]);

  readonly currentImage = computed<CatalogImageRef | undefined>(() => {
    const id = this.editingId();
    if (!id) return undefined;
    if (this.kind() === 'products') return this.store.products().find((item) => item.id === id)?.image;
    if (this.kind() === 'inputs') return this.store.inputs().find((item) => item.id === id)?.image;
    return this.store.additions().find((item) => item.id === id)?.image;
  });

  readonly categoryOptions: BfSelectOption[] = PRODUCT_CATEGORIES.map(item => ({ value: item.id, label: item.label }));
  readonly productModel = signal<ProductFormModel>({ categoryId: 'soap', modelName: '', variantName: '', description: '', volumeMl: 40, collectionId: '', fragranceId: '', formatId: '', salePrice: 0, additionalCost: 0, minimumStock: 0, active: true });
  readonly selectedCategoryLabel = computed(() => PRODUCT_CATEGORIES.find(c => c.id === this.productModel().categoryId)?.label ?? 'Produto');
  readonly productForm = form(this.productModel, (p) => {
    required(p.categoryId);
    min(p.salePrice, 0);
    min(p.minimumStock, 0);
  });

  readonly inputModel = signal<InputFormModel>({ name: '', unitId: '', trackingMode: 'estimated', availabilityStatus: '', minimumStock: 0, active: true });
  readonly inputForm = form(this.inputModel, (p) => {
    required(p.name);
    required(p.unitId);
    min(p.minimumStock, 0);
  });

  readonly additionModel = signal<AdditionFormModel>({ name: '', category: 'Embalagem', price: 0, notes: '', active: true });
  readonly additionForm = form(this.additionModel, (p) => { required(p.name); required(p.category); min(p.price, 0); });
  readonly availableFragrances = computed(() => this.references.fragrances().filter((item) => item.active && (!this.productModel().collectionId || item.collectionId === this.productModel().collectionId)));
  readonly productCollectionOptions = computed<BfSelectOption[]>(() => [
    { value: '', label: 'Selecione' },
    ...this.references.collections().filter((item) => item.active).map((item) => ({ value: item.id, label: item.name })),
  ]);
  readonly productFragranceOptions = computed<BfSelectOption[]>(() => [
    { value: '', label: 'Selecione' },
    ...this.availableFragrances().map((item) => ({ value: item.id, label: item.name })),
  ]);
  readonly productFormatOptions = computed<BfSelectOption[]>(() => [
    { value: '', label: 'Selecione' },
    ...this.references.formats().filter((item) => item.active).map((item) => ({ value: item.id, label: item.name })),
  ]);
  readonly inputUnitOptions = computed<BfSelectOption[]>(() => [
    { value: '', label: 'Selecione' },
    ...this.references.units().map((item) => ({ value: item.id, label: item.name })),
  ]);
  readonly inputTrackingOptions: readonly BfSelectOption[] = [
    { value: 'exact', icon: 'stock-exact', label: 'Controlado', description: 'Contagem exata. Entradas e consumos alteram o saldo e a falta pode bloquear a operação.' },
    { value: 'estimated', icon: 'stock-estimated', label: 'Estimado', description: 'Saldo aproximado. Compras e consumo previsto atualizam o saldo, mas a falta nunca bloqueia.' },
    { value: 'untracked', icon: 'stock-untracked', label: 'Não controlar saldo', description: 'O custo continua sendo acompanhado, mas o sistema não mantém saldo físico nem alerta de estoque.' },
  ];
  readonly inputTrackingHint = computed(() => {
    const mode = this.inputModel().trackingMode;
    if (mode === 'exact') return 'Ideal para bases glicerinadas e embalagens com contagem física. O saldo deve representar a quantidade real disponível.';
    if (mode === 'untracked') return 'Indicado para essências, corantes e lauril: atualize a disponibilidade qualitativa sem medir o líquido. Compras e composições continuam considerando o custo.';
    return 'Ideal para outros insumos com quantidades aproximadas conhecidas. Não exige precisão e não bloqueia a operação.';
  });
  readonly unitOptions = computed<BfSelectOption[]>(() =>
    this.references.units().map((item) => ({ value: item.id, label: item.name })),
  );
  readonly formatOptions = computed<BfSelectOption[]>(() =>
    this.references.formats().map((item) => ({ value: item.id, label: item.name })),
  );
  readonly activeInputOptions = computed<BfSelectOption[]>(() =>
    this.store.inputs().filter((item) => item.active).map((item) => ({ value: item.id, label: item.name })),
  );
  readonly inputOptions = computed<BfSelectOption[]>(() =>
    this.store.inputs().map((item) => ({ value: item.id, label: item.name })),
  );
  readonly inputImages = computed(() => new Map(this.store.inputs().map(item => [item.id, item.image])));
  inputImage(inputId: string): CatalogImageRef | undefined {
    return this.inputImages().get(inputId);
  }

  readonly productCostPreview = computed(() => {
    if (this.kind() !== 'products') return null;
    const model = this.productModel();
    const existing = this.store.products().find((item) => item.id === this.editingId());
    try {
      return standardCostForProduct({
        recipe: this.recipe(),
        additionalCostCents: toCents(model.additionalCost),
        averageUnitCostCents: existing?.averageUnitCostCents ?? 0,
      }, {
        collection: model.categoryId === 'soap' ? this.references.collections().find((item) => item.id === model.collectionId) : undefined,
        fragrance: model.categoryId === 'soap' ? this.references.fragrances().find((item) => item.id === model.fragranceId) : undefined,
        format: model.categoryId === 'soap' ? this.references.formats().find((item) => item.id === model.formatId) : undefined,
      }, new Map(this.store.inputs().map((item) => [item.id, item])));
    } catch {
      return null;
    }
  });

  readonly productCostSummary = computed(() => {
    const preview = this.productCostPreview();
    if (!preview) return 'Custo ainda indisponível';
    const pending = preview.components.filter((item) => item.unitCostCents <= 0).length;
    return pending
      ? `${this.currency(preview.unitCostCents)} · ${pending} custo${pending === 1 ? '' : 's'} pendente${pending === 1 ? '' : 's'}`
      : this.currency(preview.unitCostCents);
  });

  constructor() {
    this.destroyRef.onDestroy(this.references.activate());
    void Promise.all([this.store.load(), this.references.load()]);
  }

  openNew(kind: CatalogImageEntityKind): void {
    this.kind.set(kind);
    this.editingId.set('');
    this.resetImageChange();
    if (kind === 'products') {
      this.productModel.set({ categoryId: 'soap', modelName: '', variantName: '', description: '', volumeMl: 40, collectionId: '', fragranceId: '', formatId: '', salePrice: 0, additionalCost: 0, minimumStock: 0, active: true });
      this.recipe.set([]);
    } else if (kind === 'inputs') {
      this.inputModel.set({ name: '', unitId: '', trackingMode: 'estimated', availabilityStatus: '', minimumStock: 0, active: true });
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
    this.productModel.set({ categoryId: productCategoryId(item), modelName: item.modelName ?? '', variantName: item.variantName ?? '', description: item.description ?? '', volumeMl: item.volumeMl ?? 40, collectionId: item.collectionId, fragranceId: item.fragranceId, formatId: item.formatId, salePrice: fromCents(item.salePriceCents), additionalCost: fromCents(item.additionalCostCents), minimumStock: item.minimumStock, active: item.active });
    this.recipe.set(item.recipe.map((component) => ({ ...component })));
    this.dialog().open();
  }

  editInput(item: InputItem): void {
    this.kind.set('inputs');
    this.editingId.set(item.id);
    this.resetImageChange();
    const trackingMode = trackingModeForInput(item);
    this.inputModel.set({
      name: item.name,
      unitId: item.unitId,
      trackingMode,
      availabilityStatus: item.availabilityStatus ?? '',
      minimumStock: trackingMode === 'untracked' ? 0 : item.minimumStock,
      active: item.active,
    });
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
    if (input) this.recipe.update((items) => [...items, { inputId: input.id, quantity: 0, unitId: input.unitId }]);
  }

  patchRecipe(index: number, patch: Partial<RecipeComponent>): void {
    this.recipe.update((items) => items.map((item, i) => i === index ? { ...item, ...patch } : item));
  }

  patchRecipeInput(index: number, inputId: string): void {
    const input = this.store.inputs().find((item) => item.id === inputId);
    this.patchRecipe(index, { inputId, unitId: input?.unitId ?? '' });
  }

  removeRecipe(index: number): void {
    this.recipe.update((items) => items.filter((_, i) => i !== index));
  }

  addAdditionComponent(): void {
    const input = this.store.activeInputs()[0];
    if (input) this.additionComponents.update((items) => [...items, { id: crypto.randomUUID(), inputId: input.id, quantity: 1, unitId: input.unitId, order: items.length + 1 }]);
  }

  patchAdditionComponent(index: number, patch: Partial<AdditionComponent>): void {
    this.additionComponents.update((items) => items.map((item, i) => i === index ? { ...item, ...patch } : item));
  }

  patchAdditionInput(index: number, inputId: string): void {
    const input = this.store.inputs().find((item) => item.id === inputId);
    this.patchAdditionComponent(index, { inputId, unitId: input?.unitId ?? '' });
  }

  unitName(unitId: string): string {
    return this.references.units().find((item) => item.id === unitId)?.name ?? '—';
  }

  removeAdditionComponent(index: number): void {
    this.additionComponents.update((items) => items.filter((_, i) => i !== index).map((item, i) => ({ ...item, order: i + 1 })));
  }

  async save(): Promise<void> {
    if (this.saving()) return;
    this.saving.set(true);
    try {
      if (this.isCreatingSoap()) {
        const result = await this.soapCreator()!.save();
        // A gravação dos produtos já foi concluída. Falhas no upload não podem repetir o lote.
        if (result.singleProductId && this.soapCreator()!.candidateCount() === 1 && this.imageFile()) {
          try {
            const id = result.singleProductId;
            await this.applyImageChange('products', id, undefined, image => this.store.setProductImage(id, image));
          } catch {
            this.toast.error('Produto criado, mas não foi possível salvar a imagem. Adicione a foto pela edição do produto.');
          }
        }
        const count = result.createdCount;
        this.toast.success(count + (count === 1 ? ' produto criado com sucesso.' : ' produtos criados com sucesso.'));
      } else if (this.kind() === 'products') {
        await this.saveProduct();
        this.toast.success('Cadastro salvo com sucesso.');
      } else if (this.kind() === 'inputs') {
        await this.saveInput();
        this.toast.success('Cadastro salvo com sucesso.');
      } else {
        await this.saveAddition();
        this.toast.success('Cadastro salvo com sucesso.');
      }
      this.dialog().closeAfterSuccess();
    } catch (error) {
      this.toast.error(this.errors.message(error));
    } finally {
      this.saving.set(false);
    }
  }

  private async saveProduct(): Promise<void> {
    if (this.productForm().invalid()) throw new Error('Revise os campos obrigatórios.');
    const model = this.productModel();
    const soap = model.categoryId === 'soap';
    const collection = this.references.collections().find((item) => item.id === model.collectionId);
    const fragrance = this.references.fragrances().find((item) => item.id === model.fragranceId);
    const format = this.references.formats().find((item) => item.id === model.formatId);
    if (soap && (!collection || !fragrance || !format || fragrance.collectionId !== collection.id)) throw new Error('Coleção, fragrância ou formato inválido.');
    if (!soap && (!model.modelName.trim() || (model.categoryId === 'scented-candle' && (!model.variantName.trim() || !Number.isFinite(model.volumeMl) || model.volumeMl <= 0)))) throw new Error('Informe modelo, aroma e volume válidos para a categoria.');
    const existing = this.store.products().find((item) => item.id === this.editingId());
    if (existing && productCategoryId(existing) !== model.categoryId) throw new Error('A categoria de um produto existente não pode ser alterada.');
    const identity = productIdentity({ categoryId: model.categoryId, collectionId: soap ? model.collectionId : '', fragranceId: soap ? model.fragranceId : '', formatId: soap ? model.formatId : '', modelName: soap ? undefined : model.modelName, variantName: model.categoryId === 'scented-candle' ? model.variantName : '' });
    if (this.store.products().some(item => item.id !== existing?.id && productIdentity(item) === identity)) throw new Error('Já existe um produto com estas características.');
    const product: Product = {
      id: existing?.id ?? '', code: existing?.code ?? '', active: model.active, categoryId: model.categoryId,
      ...(soap ? {} : { modelName: model.modelName.trim(), ...(model.categoryId === 'scented-candle' ? { variantName: model.variantName.trim(), volumeMl: model.volumeMl } : {}), ...(model.description.trim() ? { description: model.description.trim() } : {}) }),
      collectionId: soap ? model.collectionId : '', fragranceId: soap ? model.fragranceId : '', formatId: soap ? model.formatId : '',
      displayName: soap ? `${collection!.name} · ${fragrance!.name} · ${format!.name}` : [model.modelName.trim(), model.categoryId === 'scented-candle' ? model.variantName.trim() : ''].filter(Boolean).join(' · '),
      salePriceCents: toCents(model.salePrice), additionalCostCents: toCents(model.additionalCost), averageUnitCostCents: existing?.averageUnitCostCents ?? 0,
      stock: existing?.stock ?? 0, minimumStock: model.minimumStock, image: existing?.image,
      recipe: this.recipe().filter((item) => item.inputId && item.quantity > 0 && item.unitId),
    };
    const id = await this.store.saveProduct(product);
    // Se a imagem falhar após salvar o cadastro, a próxima tentativa atualiza o mesmo documento.
    this.editingId.set(id);
    await this.applyImageChange('products', id, existing?.image, (image) => this.store.setProductImage(id, image));
  }

  private async saveInput(): Promise<void> {
    if (this.inputForm().invalid()) throw new Error('Revise os campos obrigatórios.');
    const model = this.inputModel();
    const existing = this.store.inputs().find((item) => item.id === this.editingId());
    const tracked = model.trackingMode !== 'untracked';
    const input: InputItem = {
      id: existing?.id ?? '',
      code: existing?.code ?? '',
      active: model.active,
      name: model.name.trim(),
      unitId: model.unitId,
      trackingMode: model.trackingMode,
      availabilityStatus: model.trackingMode === 'exact' ? undefined : model.availabilityStatus.trim().slice(0,240) || undefined,
      stock: existing?.stock ?? 0,
      minimumStock: tracked ? model.minimumStock : 0,
      minimumStockConfigured: tracked,
      averageUnitCostCents: existing?.averageUnitCostCents ?? 0,
      costBasisQuantity: existing?.costBasisQuantity,
      costBasisValueCents: existing?.costBasisValueCents,
      image: existing?.image,
    };
    const id = await this.store.saveInput(input);
    // Se a imagem falhar após salvar o cadastro, a próxima tentativa atualiza o mesmo documento.
    this.editingId.set(id);
    await this.applyImageChange('inputs', id, existing?.image, (image) => this.store.setInputImage(id, image));
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
    const id = await this.store.saveAddition(addition);
    // Se a imagem falhar após salvar o cadastro, a próxima tentativa atualiza o mesmo documento.
    this.editingId.set(id);
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

  private resetImageChange(): void {
    this.imageFile.set(null);
    this.removeImage.set(false);
  }
}
