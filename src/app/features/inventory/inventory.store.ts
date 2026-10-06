import { effect, inject, Injectable, signal } from '@angular/core';
import { StockMovement } from '../../domain/models/inventory.model';
import { DataRevisionService } from '../../core/firebase/data-revision.service';
import { StockAdjustmentResult } from '../../core/repositories/mutation-results';
import { BusinessDateCursor, compareBusinessDateDesc } from '../../core/repositories/pagination';
import { InventoryRepository } from '../../core/repositories/inventory.repository';
import { ErrorService } from '../../core/services/error.service';
import { ToastService } from '../../core/services/toast.service';

const PAGE_SIZE = 40;

@Injectable({ providedIn: 'root' })
export class InventoryStore {
  private readonly repository = inject(InventoryRepository);
  private readonly revisions = inject(DataRevisionService);
  private readonly toast = inject(ToastService);
  private readonly errors = inject(ErrorService);
  private readonly remoteRevision = this.revisions.revision('inventory');
  private lastRemoteRevision = 0;
  private activeConsumers = 0;
  private currentItemId = '';
  private cursor: BusinessDateCursor | null = null;

  private readonly movementsState = signal<StockMovement[]>([]);
  private readonly hasMoreState = signal(false);

  readonly movements = this.movementsState.asReadonly();
  readonly hasMore = this.hasMoreState.asReadonly();

  constructor() {
    effect(() => {
      const revision = this.remoteRevision();
      if (revision === this.lastRemoteRevision) return;
      this.lastRemoteRevision = revision;
      if (this.activeConsumers > 0 && this.currentItemId) void this.loadMovements(this.currentItemId);
    });
  }

  activate(): () => void {
    this.activeConsumers += 1;
    return () => { this.activeConsumers = Math.max(0, this.activeConsumers - 1); };
  }

  async loadMovements(itemId: string): Promise<void> {
    try {
      const page = await this.repository.movementPage(itemId, PAGE_SIZE);
      this.currentItemId = itemId;
      this.cursor = page.nextCursor;
      this.hasMoreState.set(page.hasMore);
      this.movementsState.set(page.items);
    } catch (error) {
      this.toast.error(this.errors.message(error));
    }
  }

  async loadMoreMovements(): Promise<void> {
    if (!this.currentItemId || !this.cursor || !this.hasMoreState()) return;
    try {
      const page = await this.repository.movementPage(this.currentItemId, PAGE_SIZE, this.cursor);
      const known = new Set(this.movementsState().map((item) => item.id));
      this.movementsState.update((items) => [...items, ...page.items.filter((item) => !known.has(item.id))]);
      this.cursor = page.nextCursor;
      this.hasMoreState.set(page.hasMore);
    } catch (error) {
      this.toast.error(this.errors.message(error));
    }
  }

  async adjust(
    itemType: 'product' | 'input',
    itemId: string,
    quantity: number,
    reason: string,
    date: string,
  ): Promise<StockAdjustmentResult | null> {
    try {
      const result = await this.repository.adjust(itemType, itemId, quantity, reason, date);
      this.toast.success('Ajuste registrado com sucesso.');
      if (this.currentItemId === itemId) {
        this.movementsState.update((items) => [result.movement, ...items.filter((item) => item.id !== result.movement.id)].sort(compareBusinessDateDesc));
      }
      return result;
    } catch (error) {
      this.toast.error(this.errors.message(error));
      return null;
    }
  }
}
