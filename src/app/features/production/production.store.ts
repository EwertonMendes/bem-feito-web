import { effect, inject, Injectable, signal } from '@angular/core';
import { Production } from '../../domain/models/production.model';
import { DataRevisionService } from '../../core/firebase/data-revision.service';
import { ProductionCreateResult } from '../../core/repositories/mutation-results';
import { BusinessDateCursor } from '../../core/repositories/pagination';
import { ProductionRepository } from '../../core/repositories/production.repository';
import { ErrorService } from '../../core/services/error.service';
import { ToastService } from '../../core/services/toast.service';
import { AsyncLoadGate } from '../../core/state/async-load-gate';

const PAGE_SIZE = 40;

@Injectable({ providedIn: 'root' })
export class ProductionStore {
  private readonly repository = inject(ProductionRepository);
  private readonly revisions = inject(DataRevisionService);
  private readonly toast = inject(ToastService);
  private readonly errors = inject(ErrorService);
  private readonly gate = new AsyncLoadGate();
  private readonly remoteRevision = this.revisions.revision('production');
  private lastRemoteRevision = 0;
  private cursor: BusinessDateCursor | null = null;

  private readonly itemsState = signal<Production[]>([]);
  private readonly loadingState = signal(false);
  private readonly hasMoreState = signal(false);

  readonly items = this.itemsState.asReadonly();
  readonly loading = this.loadingState.asReadonly();
  readonly hasMore = this.hasMoreState.asReadonly();

  constructor() {
    effect(() => {
      const revision = this.remoteRevision();
      if (revision === this.lastRemoteRevision) return;
      this.lastRemoteRevision = revision;
      if (this.gate.isLoaded) void this.load(true);
    });
  }

  load(force = false): Promise<void> {
    return this.gate.run(async () => {
      this.loadingState.set(true);
      try {
        const page = await this.repository.page(PAGE_SIZE);
        this.itemsState.set(page.items);
        this.cursor = page.nextCursor;
        this.hasMoreState.set(page.hasMore);
      } catch (error) {
        this.toast.error(this.errors.message(error));
        throw error;
      } finally {
        this.loadingState.set(false);
      }
    }, force).catch(() => undefined);
  }

  async loadMore(): Promise<void> {
    if (!this.hasMoreState() || !this.cursor) return;
    try {
      const page = await this.repository.page(PAGE_SIZE, this.cursor);
      const known = new Set(this.itemsState().map((item) => item.id));
      this.itemsState.update((items) => [...items, ...page.items.filter((item) => !known.has(item.id))]);
      this.cursor = page.nextCursor;
      this.hasMoreState.set(page.hasMore);
    } catch (error) {
      this.toast.error(this.errors.message(error));
    }
  }

  async create(
    productId: string,
    quantity: number,
    businessDate: string,
    notes?: string,
  ): Promise<ProductionCreateResult | null> {
    try {
      const result = await this.repository.create(productId, quantity, businessDate, notes);
      if (this.gate.isLoaded) {
        this.itemsState.update((items) => [result.production, ...items.filter((item) => item.id !== result.production.id)]);
      }
      this.toast.success('Produção registrada com sucesso.');
      return result;
    } catch (error) {
      this.toast.error(this.errors.message(error));
      return null;
    }
  }
}
