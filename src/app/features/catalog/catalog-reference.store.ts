import { computed, effect, inject, Injectable, signal } from '@angular/core';
import { CandleModel, CollectionDefinition, FormatDefinition, FormatPrice, FragranceDefinition, UnitDefinition } from '../../domain/models/catalog.model';
import { CandleModelRepository, CollectionRepository, FormatPriceRepository, FormatRepository, FragranceRepository, UnitRepository } from '../../core/repositories/catalog.repository';
import { DataRevisionService } from '../../core/firebase/data-revision.service';
import { ErrorService } from '../../core/services/error.service';
import { ToastService } from '../../core/services/toast.service';
import { AsyncLoadGate } from '../../core/state/async-load-gate';
import { DEFAULT_CANDLE_MODEL, normalizedCatalogName } from '../../domain/logic/candle-model';

@Injectable({ providedIn: 'root' })
export class CatalogReferenceStore {
  private readonly collectionRepository = inject(CollectionRepository);
  private readonly fragranceRepository = inject(FragranceRepository);
  private readonly formatRepository = inject(FormatRepository);
  private readonly formatPriceRepository = inject(FormatPriceRepository);
  private readonly unitRepository = inject(UnitRepository);
  private readonly candleModelRepository = inject(CandleModelRepository);
  private readonly revisions = inject(DataRevisionService);
  private readonly errors = inject(ErrorService);
  private readonly toast = inject(ToastService);
  private readonly gate = new AsyncLoadGate();
  private readonly remoteRevision = this.revisions.revision('references');
  private lastRemoteRevision = 0;
  private activeConsumers = 0;

  private readonly collectionsState = signal<CollectionDefinition[]>([]);
  private readonly fragrancesState = signal<FragranceDefinition[]>([]);
  private readonly formatsState = signal<FormatDefinition[]>([]);
  private readonly formatPricesState = signal<FormatPrice[]>([]);
  private readonly unitsState = signal<UnitDefinition[]>([]);
  private readonly candleModelsState = signal<CandleModel[]>([]);
  private readonly loadingState = signal(false);
  private readonly initializedState = signal(false);

  readonly collections = this.collectionsState.asReadonly();
  readonly fragrances = this.fragrancesState.asReadonly();
  readonly formats = this.formatsState.asReadonly();
  readonly formatPrices = this.formatPricesState.asReadonly();
  readonly units = this.unitsState.asReadonly();
  /** The default preset is available even before it is customized in Settings. */
  readonly candleModels = computed(() => {
    const stored = this.candleModelsState();
    return stored.some(item => item.id === DEFAULT_CANDLE_MODEL.id)
      ? stored : [this.defaultCandleModel(), ...stored];
  });
  private defaultCandleModel(): CandleModel {
    const sourceCollectionId = this.collectionsState().find(c => normalizedCatalogName(c.name) === 'mais aroma')?.id ?? '';
    return { ...DEFAULT_CANDLE_MODEL, sourceCollectionId };
  }
  readonly loading = this.loadingState.asReadonly();
  readonly initialized = this.initializedState.asReadonly();

  constructor() {
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
      this.loadingState.set(true);
      try {
        const [collections, fragrances, formats, formatPrices, units, candleModels] = await Promise.all([
          this.collectionRepository.list(),
          this.fragranceRepository.list(),
          this.formatRepository.list(),
          this.formatPriceRepository.list(),
          this.unitRepository.list(),
          this.candleModelRepository.list(),
        ]);
        this.collectionsState.set(collections);
        this.fragrancesState.set(fragrances);
        this.formatsState.set(formats);
        this.formatPricesState.set(formatPrices);
        this.unitsState.set(units);
        this.candleModelsState.set(candleModels);
      } catch (error) {
        this.toast.error(this.errors.message(error));
        throw error;
      } finally {
        this.initializedState.set(true);
        this.loadingState.set(false);
      }
    }, force).catch(() => undefined);
  }

  async saveCandleModel(item: CandleModel): Promise<string> {
    if (!item.name.trim() || !Number.isSafeInteger(item.volumeMl) || item.volumeMl <= 0 ||
        !Number.isSafeInteger(item.priceCents) || item.priceCents < 0 ||
        !this.collectionsState().some(c => c.id === item.sourceCollectionId && c.active)) {
      throw new Error('Informe nome, volume, preço e uma coleção de aromas válida.');
    }
    if (this.candleModels().some(other => other.id !== item.id && other.volumeMl === item.volumeMl)) {
      throw new Error('Já existe um modelo de vela para este volume.');
    }
    // Preserve stable ID of the built-in preset, but create other models normally.
    const alreadyStored = this.candleModelsState().some(model => model.id === item.id);
    let id = item.id;
    if (alreadyStored) await this.candleModelRepository.replace(item);
    else {
      const { id: _id, ...data } = item;
      id = await this.candleModelRepository.create(data, item.id === DEFAULT_CANDLE_MODEL.id ? item.id : undefined);
    }
    const saved = { ...item, id };
    this.candleModelsState.update(items => items.some(model => model.id === id)
      ? items.map(model => model.id === id ? saved : model) : [...items, saved]);
    return id;
  }

  async saveCollection(item: CollectionDefinition): Promise<string> {
    return this.save(item, this.collectionRepository, this.collectionsState);
  }

  async saveFragrance(item: FragranceDefinition): Promise<string> {
    return this.save(item, this.fragranceRepository, this.fragrancesState);
  }

  async saveFormat(item: FormatDefinition): Promise<string> {
    return this.save(item, this.formatRepository, this.formatsState);
  }

  async saveFormatPrice(item: FormatPrice): Promise<void> {
    await this.save(item, this.formatPriceRepository, this.formatPricesState);
  }

  async saveUnit(item: UnitDefinition): Promise<void> {
    await this.save(item, this.unitRepository, this.unitsState);
  }

  private async save<T extends { id: string }>(
    item: T,
    repository: { create(value: Omit<T, 'id'>): Promise<string>; replace(value: T): Promise<void> },
    state: { update(updater: (items: T[]) => T[]): void },
  ): Promise<string> {
    const id = item.id || await repository.create(this.withoutId(item));
    if (item.id) await repository.replace(item);
    const saved = { ...item, id };
    state.update((items) => {
      const next = items.some((existing) => existing.id === id)
        ? items.map((existing) => existing.id === id ? saved : existing)
        : [...items, saved];
      return next;
    });
    return id;
  }

  private withoutId<T extends { id: string }>(value: T): Omit<T, 'id'> {
    const { id: _id, ...data } = value;
    return data;
  }
}
