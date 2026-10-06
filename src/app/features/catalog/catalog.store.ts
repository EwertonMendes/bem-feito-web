import { computed, inject, Injectable, signal } from '@angular/core';
import { Addition, InputItem, Kit, Product } from '../../domain/models/catalog.model';
import { CatalogImageRef } from '../../domain/models/image.model';
import { AdditionRepository, InputRepository, KitRepository, ProductRepository } from '../../core/repositories/catalog.repository';
import { ErrorService } from '../../core/services/error.service';
import { ToastService } from '../../core/services/toast.service';

@Injectable({ providedIn: 'root' })
export class CatalogStore {
  private readonly productRepository = inject(ProductRepository);
  private readonly inputRepository = inject(InputRepository);
  private readonly kitRepository = inject(KitRepository);
  private readonly additionRepository = inject(AdditionRepository);
  private readonly errors = inject(ErrorService);
  private readonly toast = inject(ToastService);

  private readonly productsState = signal<Product[]>([]);
  private readonly inputsState = signal<InputItem[]>([]);
  private readonly kitsState = signal<Kit[]>([]);
  private readonly additionsState = signal<Addition[]>([]);
  private readonly loadingState = signal(false);
  private readonly initializedState = signal(false);
  private loaded = false;

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
  readonly lowStockProducts = computed(() => this.productsState().filter((item) => item.active && item.stock <= item.minimumStock));
  readonly lowStockInputs = computed(() => this.inputsState().filter((item) => item.active && item.minimumStockConfigured !== false && item.stock <= item.minimumStock));
  readonly negativeProducts = computed(() => this.productsState().filter((item) => item.stock < 0));

  async load(force = false): Promise<void> {
    if (this.loaded && !force) return;
    this.loadingState.set(true);
    try {
      const [products, inputs, kits, additions] = await Promise.all([
        this.productRepository.all(),
        this.inputRepository.all(),
        this.kitRepository.all(),
        this.additionRepository.all(),
      ]);
      this.productsState.set(products);
      this.inputsState.set(inputs);
      this.kitsState.set(kits);
      this.additionsState.set(additions);
      this.loaded = true;
    } catch (error) {
      this.toast.error(this.errors.message(error));
    } finally {
      this.initializedState.set(true);
      this.loadingState.set(false);
    }
  }

  async saveProduct(product: Product, reload = true): Promise<string> {
    const id = product.id || await this.productRepository.create(this.withoutId(product));
    if (product.id) await this.productRepository.replace(product);
    if (reload) await this.load(true);
    return id;
  }

  async saveInput(input: InputItem, reload = true): Promise<string> {
    const id = input.id || await this.inputRepository.create(this.withoutId(input));
    if (input.id) await this.inputRepository.replace(input);
    if (reload) await this.load(true);
    return id;
  }

  async saveKit(kit: Kit, reload = true): Promise<string> {
    const id = kit.id || await this.kitRepository.create(this.withoutId(kit));
    if (kit.id) await this.kitRepository.replace(kit);
    if (reload) await this.load(true);
    return id;
  }

  async saveAddition(addition: Addition, reload = true): Promise<string> {
    const id = addition.id || await this.additionRepository.create(this.withoutId(addition));
    if (addition.id) await this.additionRepository.replace(addition);
    if (reload) await this.load(true);
    return id;
  }

  async setProductImage(id: string, image: CatalogImageRef | null): Promise<void> {
    if (image) await this.productRepository.patch(id, { image });
    else await this.productRepository.clearField(id, 'image');
    await this.load(true);
  }

  async setInputImage(id: string, image: CatalogImageRef | null): Promise<void> {
    if (image) await this.inputRepository.patch(id, { image });
    else await this.inputRepository.clearField(id, 'image');
    await this.load(true);
  }

  async setKitImage(id: string, image: CatalogImageRef | null): Promise<void> {
    if (image) await this.kitRepository.patch(id, { image });
    else await this.kitRepository.clearField(id, 'image');
    await this.load(true);
  }

  async setAdditionImage(id: string, image: CatalogImageRef | null): Promise<void> {
    if (image) await this.additionRepository.patch(id, { image });
    else await this.additionRepository.clearField(id, 'image');
    await this.load(true);
  }

  private withoutId<T extends { id: string }>(value: T): Omit<T, 'id'> {
    const { id: _id, ...data } = value;
    return data;
  }
}
