import { computed, effect, inject, Injectable, signal } from '@angular/core';
import { stockStatusForInput, stockStatusForProduct } from '../../domain/logic/stock-status';
import { Addition, InputItem, Kit, Product } from '../../domain/models/catalog.model';
import { CatalogImageRef } from '../../domain/models/image.model';
import { AdditionRepository, InputRepository, KitRepository, ProductRepository } from '../../core/repositories/catalog.repository';
import { StockChange } from '../../core/repositories/mutation-results';
import { ErrorService } from '../../core/services/error.service';
import { ToastService } from '../../core/services/toast.service';
import { DataRevisionService } from '../../core/firebase/data-revision.service';
import { AsyncLoadGate } from '../../core/state/async-load-gate';
import { catalogEntityCode } from '../../core/utils/ids';

@Injectable({ providedIn: 'root' })
export class CatalogStore {
  private readonly productRepository = inject(ProductRepository);
  private readonly inputRepository = inject(InputRepository);
  private readonly kitRepository = inject(KitRepository);
  private readonly additionRepository = inject(AdditionRepository);
  private readonly revisions = inject(DataRevisionService);
  private readonly errors = inject(ErrorService);
  private readonly toast = inject(ToastService);
  private readonly gate = new AsyncLoadGate();
  private readonly inventoryRefreshGate = new AsyncLoadGate();
  private readonly remoteRevision = this.revisions.revision('catalog');
  private readonly inventoryRevision = this.revisions.revision('inventory');
  private lastRemoteRevision = 0;
  private lastInventoryRevision = 0;
  private activeConsumers = 0;
  private catalogRequest = 0;
  private inventoryRequest = 0;

  private readonly productsState = signal<Product[]>([]);
  private readonly inputsState = signal<InputItem[]>([]);
  private readonly kitsState = signal<Kit[]>([]);
  private readonly additionsState = signal<Addition[]>([]);
  private readonly loadingState = signal(false);
  private readonly initializedState = signal(false);

  readonly products = this.productsState.asReadonly();
  readonly inputs = this.inputsState.asReadonly();
  readonly kits = this.kitsState.asReadonly();
  readonly additions = this.additionsState.asReadonly();
  readonly loading = this.loadingState.asReadonly();
  readonly initialized = this.initializedState.asReadonly();

  readonly activeProducts = computed(() => this.productsState().filter((item) => item.active));
  readonly activeInputs = computed(() => this.inputsState().filter((item) => item.active));
  readonly activeKits = computed(() => this.kitsState().filter((item) => item.active));
  readonly activeAdditions = computed(() => this.additionsState().filter((item) => item.active));
  readonly lowStockProducts = computed(() => this.productsState().filter((item) => item.active && ['negative', 'low'].includes(stockStatusForProduct(item))));
  readonly lowStockInputs = computed(() => this.inputsState().filter((item) => item.active && ['negative', 'low'].includes(stockStatusForInput(item))));

  constructor() {
    effect(() => {
      const revision = this.inventoryRevision();
      if (revision === this.lastInventoryRevision) return;
      this.lastInventoryRevision = revision;

      if (this.activeConsumers > 0 && this.gate.isLoaded) {
        void this.refreshInventoryEntities();
      } else {
        this.gate.invalidate();
      }
    });

    effect(() => {
      const revision = this.remoteRevision();
      if (revision === this.lastRemoteRevision) return;
      this.lastRemoteRevision = revision;
      const refresh = this.activeConsumers > 0 && this.gate.isLoaded;
      this.gate.invalidate();
      if (refresh) void this.load();
    });
  }

  activate(): () => void {
    this.activeConsumers += 1;
    return () => { this.activeConsumers = Math.max(0, this.activeConsumers - 1); };
  }

  load(force = false): Promise<void> {
    return this.gate.run(async () => {
      const request = ++this.catalogRequest;
      this.inventoryRequest += 1;
      this.loadingState.set(true);
      try {
        const [products, inputs, kits, additions] = await Promise.all([
          this.productRepository.all(),
          this.inputRepository.all(),
          this.kitRepository.all(),
          this.additionRepository.all(),
        ]);
        if (request !== this.catalogRequest) return;
        this.productsState.set(products.map((item) => this.normalizeProduct(item)));
        this.inputsState.set(inputs.map((item) => this.normalizeInput(item)));
        this.kitsState.set(kits);
        this.additionsState.set(additions);
      } catch (error) {
        this.toast.error(this.errors.message(error));
        throw error;
      } finally {
        this.initializedState.set(true);
        this.loadingState.set(false);
      }
    }, force).catch(() => undefined);
  }

  private refreshInventoryEntities(): Promise<void> {
    return this.inventoryRefreshGate.run(async () => {
      const request = ++this.inventoryRequest;
      const catalogRequest = this.catalogRequest;
      try {
        const [products, inputs] = await Promise.all([
          this.productRepository.all(),
          this.inputRepository.all(),
        ]);
        if (request !== this.inventoryRequest || catalogRequest !== this.catalogRequest) return;
        this.productsState.set(products.map((item) => this.normalizeProduct(item)));
        this.inputsState.set(inputs.map((item) => this.normalizeInput(item)));
      } catch (error) {
        this.toast.error(this.errors.message(error));
        throw error;
      }
    }, true).catch(() => undefined);
  }

  async saveProduct(product: Product): Promise<string> {
    const base = { ...product, stockStatus: stockStatusForProduct(product) };
    if (base.id) {
      const normalized = this.normalizeProduct(base);
      await this.productRepository.replace(normalized);
      this.upsertProduct(normalized);
      return normalized.id;
    }

    const id = await this.productRepository.create((allocatedId) =>
      this.withoutId(this.normalizeProduct({ ...base, id: allocatedId }))
    );
    this.upsertProduct(this.normalizeProduct({ ...base, id }));
    return id;
  }

  async createProductVariations(products: readonly Product[]): Promise<Product[]> {
    const created = await this.productRepository.createMany(products);
    const combined = [...this.productsState(), ...created].sort((a, b) =>
      a.displayName.localeCompare(b.displayName, 'pt-BR'));
    this.productsState.set(combined);
    return created;
  }

  async saveInput(input: InputItem): Promise<string> {
    const base = { ...input, stockStatus: stockStatusForInput(input) };
    if (base.id) {
      const normalized = this.normalizeInput(base);
      await this.inputRepository.replace(normalized);
      this.upsertInput(normalized);
      return normalized.id;
    }

    const id = await this.inputRepository.create((allocatedId) =>
      this.withoutId(this.normalizeInput({ ...base, id: allocatedId }))
    );
    this.upsertInput(this.normalizeInput({ ...base, id }));
    return id;
  }

  async saveKit(kit: Kit): Promise<string> {
    const id = kit.id || await this.kitRepository.create(this.withoutId(kit));
    if (kit.id) await this.kitRepository.replace(kit);
    this.kitsState.update((items) => this.upsert(items, { ...kit, id }, (item) => item.name));
    return id;
  }

  async saveAddition(addition: Addition): Promise<string> {
    const id = addition.id || await this.additionRepository.create(this.withoutId(addition));
    if (addition.id) await this.additionRepository.replace(addition);
    this.additionsState.update((items) => this.upsert(items, { ...addition, id }, (item) => item.name));
    return id;
  }

  async setProductImage(id: string, image: CatalogImageRef | null): Promise<void> {
    if (image) await this.productRepository.patch(id, { image });
    else await this.productRepository.clearField(id, 'image');
    this.productsState.update((items) => items.map((item) =>
      item.id === id ? this.withImage(item, image) : item
    ));
  }

  async setInputImage(id: string, image: CatalogImageRef | null): Promise<void> {
    if (image) await this.inputRepository.patch(id, { image });
    else await this.inputRepository.clearField(id, 'image');
    this.inputsState.update((items) => items.map((item) =>
      item.id === id ? this.withImage(item, image) : item
    ));
  }

  async setKitImage(id: string, image: CatalogImageRef | null): Promise<void> {
    if (image) await this.kitRepository.patch(id, { image });
    else await this.kitRepository.clearField(id, 'image');
    this.kitsState.update((items) => items.map((item) =>
      item.id === id ? this.withImage(item, image) : item
    ));
  }

  async setAdditionImage(id: string, image: CatalogImageRef | null): Promise<void> {
    if (image) await this.additionRepository.patch(id, { image });
    else await this.additionRepository.clearField(id, 'image');
    this.additionsState.update((items) => items.map((item) =>
      item.id === id ? this.withImage(item, image) : item
    ));
  }

  applyStockChanges(changes: readonly StockChange[]): void {
    if (!changes.length) return;

    const productChanges = new Map(changes.filter((item) => item.itemType === 'product').map((item) => [item.itemId, item]));
    const inputChanges = new Map(changes.filter((item) => item.itemType === 'input').map((item) => [item.itemId, item]));

    if (productChanges.size) {
      this.productsState.update((items) => items.map((item) => {
        const change = productChanges.get(item.id);
        if (!change) return item;
        const updated: Product = {
          ...item,
          stock: change.stock,
          committedStock: change.committedStock ?? item.committedStock,
          reservedPhysicalStock: change.reservedPhysicalStock ?? item.reservedPhysicalStock,
          averageUnitCostCents: change.averageUnitCostCents ?? item.averageUnitCostCents,
        };
        return { ...updated, stockStatus: stockStatusForProduct(updated) };
      }));
    }

    if (inputChanges.size) {
      this.inputsState.update((items) => items.map((item) => {
        const change = inputChanges.get(item.id);
        if (!change) return item;
        const updated: InputItem = {
          ...item,
          stock: change.stock,
          committedStock: change.committedStock ?? item.committedStock,
          reservedPhysicalStock: change.reservedPhysicalStock ?? item.reservedPhysicalStock,
          averageUnitCostCents: change.averageUnitCostCents ?? item.averageUnitCostCents,
        };
        return { ...updated, stockStatus: stockStatusForInput(updated) };
      }));
    }
  }

  private normalizeProduct(product: Product): Product {
    return { ...product, code: catalogEntityCode('PROD', product.id) };
  }

  private normalizeInput(input: InputItem): InputItem {
    return { ...input, code: catalogEntityCode('INS', input.id) };
  }

  private upsertProduct(product: Product): void {
    this.productsState.update((items) => this.upsert(items, product, (item) => item.displayName));
  }

  private upsertInput(input: InputItem): void {
    this.inputsState.update((items) => this.upsert(items, input, (item) => item.name));
  }

  private upsert<T extends { id: string }>(items: T[], value: T, sortKey: (item: T) => string): T[] {
    const next = items.some((item) => item.id === value.id)
      ? items.map((item) => item.id === value.id ? value : item)
      : [...items, value];
    return [...next].sort((a, b) => sortKey(a).localeCompare(sortKey(b), 'pt-BR'));
  }

  private withImage<T extends { image?: CatalogImageRef }>(item: T, image: CatalogImageRef | null): T {
    if (image) return { ...item, image };
    const { image: _image, ...rest } = item;
    return rest as T;
  }

  private withoutId<T extends { id: string }>(value: T): Omit<T, 'id'> {
    const { id: _id, ...data } = value;
    return data;
  }
}
