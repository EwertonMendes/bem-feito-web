import { inject, Injectable, signal } from '@angular/core';
import { CollectionDefinition, FormatDefinition, FormatPrice, FragranceDefinition, UnitDefinition } from '../../domain/models/catalog.model';
import { CollectionRepository, FormatPriceRepository, FormatRepository, FragranceRepository, UnitRepository } from '../../core/repositories/catalog.repository';
import { ErrorService } from '../../core/services/error.service';
import { ToastService } from '../../core/services/toast.service';

@Injectable({ providedIn: 'root' })
export class CatalogReferenceStore {
  private readonly collectionRepository = inject(CollectionRepository);
  private readonly fragranceRepository = inject(FragranceRepository);
  private readonly formatRepository = inject(FormatRepository);
  private readonly formatPriceRepository = inject(FormatPriceRepository);
  private readonly unitRepository = inject(UnitRepository);
  private readonly errors = inject(ErrorService);
  private readonly toast = inject(ToastService);

  private readonly collectionsState = signal<CollectionDefinition[]>([]);
  private readonly fragrancesState = signal<FragranceDefinition[]>([]);
  private readonly formatsState = signal<FormatDefinition[]>([]);
  private readonly formatPricesState = signal<FormatPrice[]>([]);
  private readonly unitsState = signal<UnitDefinition[]>([]);
  private readonly loadingState = signal(false);
  private readonly initializedState = signal(false);
  private loaded = false;

  readonly collections = this.collectionsState.asReadonly();
  readonly fragrances = this.fragrancesState.asReadonly();
  readonly formats = this.formatsState.asReadonly();
  readonly formatPrices = this.formatPricesState.asReadonly();
  readonly units = this.unitsState.asReadonly();
  readonly loading = this.loadingState.asReadonly();
  readonly initialized = this.initializedState.asReadonly();

  async load(force = false): Promise<void> {
    if (this.loaded && !force) return;
    this.loadingState.set(true);
    try {
      const [collections, fragrances, formats, formatPrices, units] = await Promise.all([
        this.collectionRepository.list(),
        this.fragranceRepository.list(),
        this.formatRepository.list(),
        this.formatPriceRepository.list(),
        this.unitRepository.list(),
      ]);
      this.collectionsState.set(collections);
      this.fragrancesState.set(fragrances);
      this.formatsState.set(formats);
      this.formatPricesState.set(formatPrices);
      this.unitsState.set(units);
      this.loaded = true;
    } catch (error) {
      this.toast.error(this.errors.message(error));
    } finally {
      this.initializedState.set(true);
      this.loadingState.set(false);
    }
  }

  async saveCollection(item: CollectionDefinition): Promise<void> {
    await this.save(item, this.collectionRepository);
  }

  async saveFragrance(item: FragranceDefinition): Promise<void> {
    await this.save(item, this.fragranceRepository);
  }

  async saveFormat(item: FormatDefinition): Promise<void> {
    await this.save(item, this.formatRepository);
  }

  async saveFormatPrice(item: FormatPrice): Promise<void> {
    await this.save(item, this.formatPriceRepository);
  }

  async saveUnit(item: UnitDefinition): Promise<void> {
    await this.save(item, this.unitRepository);
  }

  private async save<T extends { id: string }>(
    item: T,
    repository: { create(value: Omit<T, 'id'>): Promise<string>; replace(value: T): Promise<void> },
  ): Promise<void> {
    if (item.id) await repository.replace(item);
    else await repository.create(this.withoutId(item));
    await this.load(true);
  }

  private withoutId<T extends { id: string }>(value: T): Omit<T, 'id'> {
    const { id: _id, ...data } = value;
    return data;
  }
}
