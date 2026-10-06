import { computed, effect, inject, Injectable, signal } from '@angular/core';
import { Sale, SaleDraft } from '../../domain/models/sales.model';
import { DataRevisionService } from '../../core/firebase/data-revision.service';
import {
  SaleCancellationResult,
  SaleCreateResult,
  SalePaymentResult,
  SalePaymentReversalResult,
} from '../../core/repositories/mutation-results';
import { BusinessDateCursor, compareBusinessDateDesc } from '../../core/repositories/pagination';
import { SalesRepository } from '../../core/repositories/sales.repository';
import { ErrorService } from '../../core/services/error.service';
import { ToastService } from '../../core/services/toast.service';
import { AsyncLoadGate } from '../../core/state/async-load-gate';

const PAGE_SIZE = 40;
const RECEIVABLE_PAGE_SIZE = 40;

@Injectable({ providedIn: 'root' })
export class SalesStore {
  private readonly repository = inject(SalesRepository);
  private readonly revisions = inject(DataRevisionService);
  private readonly toast = inject(ToastService);
  private readonly errors = inject(ErrorService);
  private readonly salesGate = new AsyncLoadGate();
  private readonly receivablesGate = new AsyncLoadGate();
  private readonly receivableSummaryGate = new AsyncLoadGate();
  private readonly remoteRevision = this.revisions.revision('sales');
  private lastRemoteRevision = 0;
  private salesConsumers = 0;
  private receivableConsumers = 0;
  private cursor: BusinessDateCursor | null = null;
  private receivableCursor: BusinessDateCursor | null = null;

  private readonly salesState = signal<Sale[]>([]);
  private readonly receivablesState = signal<Sale[]>([]);
  private readonly receivableTotalState = signal(0);
  private readonly loadingState = signal(false);
  private readonly loadingMoreState = signal(false);
  private readonly hasMoreState = signal(false);
  private readonly receivableHasMoreState = signal(false);

  readonly sales = this.salesState.asReadonly();
  readonly loading = this.loadingState.asReadonly();
  readonly loadingMore = this.loadingMoreState.asReadonly();
  readonly hasMore = this.hasMoreState.asReadonly();
  readonly openSales = computed(() => this.receivablesState());
  readonly receivableHasMore = this.receivableHasMoreState.asReadonly();
  readonly receivableTotalCents = this.receivableTotalState.asReadonly();

  constructor() {
    effect(() => {
      const revision = this.remoteRevision();
      if (revision === this.lastRemoteRevision) return;
      this.lastRemoteRevision = revision;
      const refreshSales = this.salesConsumers > 0 && this.salesGate.isLoaded;
      const refreshReceivables = this.receivableConsumers > 0 && this.receivablesGate.isLoaded;
      const refreshReceivableSummary = this.receivableConsumers > 0 && this.receivableSummaryGate.isLoaded;
      this.salesGate.invalidate();
      this.receivablesGate.invalidate();
      this.receivableSummaryGate.invalidate();
      if (refreshSales) void this.load();
      if (refreshReceivables) void this.loadReceivables();
      if (refreshReceivableSummary) void this.loadReceivableSummary();
    });
  }

  activateSales(): () => void {
    this.salesConsumers += 1;
    return () => { this.salesConsumers = Math.max(0, this.salesConsumers - 1); };
  }

  activateReceivables(): () => void {
    this.receivableConsumers += 1;
    return () => { this.receivableConsumers = Math.max(0, this.receivableConsumers - 1); };
  }

  load(force = false): Promise<void> {
    return this.salesGate.run(async () => {
      this.loadingState.set(true);
      try {
        const page = await this.repository.page(PAGE_SIZE);
        this.salesState.set(page.items);
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
    if (!this.hasMoreState() || this.loadingMoreState() || !this.cursor) return;
    this.loadingMoreState.set(true);
    try {
      const page = await this.repository.page(PAGE_SIZE, this.cursor);
      const known = new Set(this.salesState().map((item) => item.id));
      this.salesState.update((items) => [...items, ...page.items.filter((item) => !known.has(item.id))]);
      this.cursor = page.nextCursor;
      this.hasMoreState.set(page.hasMore);
    } catch (error) {
      this.toast.error(this.errors.message(error));
    } finally {
      this.loadingMoreState.set(false);
    }
  }

  loadReceivables(force = false): Promise<void> {
    return this.receivablesGate.run(async () => {
      try {
        const page = await this.repository.receivablePage(RECEIVABLE_PAGE_SIZE);
        this.receivablesState.set(page.items);
        this.receivableCursor = page.nextCursor;
        this.receivableHasMoreState.set(page.hasMore);
      } catch (error) {
        this.toast.error(this.errors.message(error));
        throw error;
      }
    }, force).catch(() => undefined);
  }

  loadReceivableSummary(force = false): Promise<void> {
    return this.receivableSummaryGate.run(async () => {
      try {
        this.receivableTotalState.set(await this.repository.receivableTotalCents());
      } catch (error) {
        this.toast.error(this.errors.message(error));
        throw error;
      }
    }, force).catch(() => undefined);
  }

  async loadMoreReceivables(): Promise<void> {
    if (!this.receivableHasMoreState() || !this.receivableCursor) return;
    try {
      const page = await this.repository.receivablePage(RECEIVABLE_PAGE_SIZE, this.receivableCursor);
      const known = new Set(this.receivablesState().map((item) => item.id));
      this.receivablesState.update((items) => [...items, ...page.items.filter((item) => !known.has(item.id))]);
      this.receivableCursor = page.nextCursor;
      this.receivableHasMoreState.set(page.hasMore);
    } catch (error) {
      this.toast.error(this.errors.message(error));
    }
  }

  async create(draft: SaleDraft): Promise<SaleCreateResult | null> {
    try {
      const result = await this.repository.create(draft);
      if (this.salesGate.isLoaded) this.prependSale(result.sale);
      this.syncReceivable(result.sale, 0);
      this.toast.success('Venda registrada com sucesso.');
      return result;
    } catch (error) {
      this.toast.error(this.errors.message(error));
      return null;
    }
  }

  async addPayment(
    saleId: string,
    businessDate: string,
    methodId: string,
    amountReceivedCents: number,
  ): Promise<SalePaymentResult | null> {
    try {
      const result = await this.repository.addPayment(saleId, businessDate, methodId, amountReceivedCents);
      this.patchSale(result.sale);
      this.syncReceivable(result.sale, result.previousBalanceCents);
      this.toast.success('Recebimento registrado com sucesso.');
      return result;
    } catch (error) {
      this.toast.error(this.errors.message(error));
      return null;
    }
  }

  async reversePayment(paymentId: string): Promise<SalePaymentReversalResult | null> {
    try {
      const result = await this.repository.reversePayment(paymentId);
      this.patchSale(result.sale);
      this.syncReceivable(result.sale, result.previousBalanceCents);
      this.toast.success('Recebimento estornado.');
      return result;
    } catch (error) {
      this.toast.error(this.errors.message(error));
      return null;
    }
  }

  async cancel(sale: Sale): Promise<SaleCancellationResult | null> {
    try {
      const result = await this.repository.cancel(sale.id);
      this.patchSale(result.sale);
      this.syncReceivable(result.sale, result.previousBalanceCents);
      this.toast.success(`${sale.code} cancelada e estoque revertido.`);
      return result;
    } catch (error) {
      this.toast.error(this.errors.message(error));
      return null;
    }
  }

  private prependSale(sale: Sale): void {
    this.salesState.update((items) => [sale, ...items.filter((item) => item.id !== sale.id)].sort(compareBusinessDateDesc));
  }

  private patchSale(sale: Sale): void {
    if (this.salesGate.isLoaded) {
      this.salesState.update((items) => items.map((item) => item.id === sale.id ? sale : item));
    }
  }

  private syncReceivable(sale: Sale, previousBalance: number): void {
    const currentBalance = sale.status === 'active' ? Math.max(0, sale.balanceCents) : 0;

    if (this.receivableSummaryGate.isLoaded) {
      this.receivableTotalState.update((value) =>
        Math.max(0, value - Math.max(0, previousBalance) + currentBalance)
      );
    }

    if (this.receivablesGate.isLoaded) {
      this.receivablesState.update((items) => {
        const without = items.filter((item) => item.id !== sale.id);
        if (currentBalance <= 0) return without;
        return [sale, ...without].sort(compareBusinessDateDesc);
      });
    }
  }

}
