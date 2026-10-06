import { computed, effect, inject, Injectable, signal } from '@angular/core';
import { ReadOptimizationBackfillService } from '../../core/migrations/read-optimization-backfill.service';
import { DataRevisionService } from '../../core/firebase/data-revision.service';
import { ErrorService } from '../../core/services/error.service';
import { ToastService } from '../../core/services/toast.service';
import {
  DashboardMetrics,
  DashboardRepository,
  MonthlyRevenuePoint,
} from '../../core/repositories/dashboard.repository';
import {
  businessMonthDateRange,
  currentMonthBusinessDateRange,
  todayBusinessDate,
} from '../../core/utils/date';

const EMPTY_METRICS: DashboardMetrics = {
  revenueCents: 0,
  receivedCents: 0,
  cashReceivedCents: 0,
  receivableCents: 0,
  operationalExpenseCents: 0,
  cashOutCents: 0,
  tipsCents: 0,
  cogsCents: 0,
  missingCostItems: 0,
  saleCount: 0,
  itemsSold: 0,
  overdueCount: 0,
  negativeProducts: 0,
  lowStockProducts: 0,
  lowStockInputs: 0,
};

@Injectable({ providedIn: 'root' })
export class DashboardStore {
  private readonly repository = inject(DashboardRepository);
  private readonly backfill = inject(ReadOptimizationBackfillService);
  private readonly revisions = inject(DataRevisionService);
  private readonly errors = inject(ErrorService);
  private readonly toast = inject(ToastService);
  private readonly salesRevision = this.revisions.changeRevision('sales');
  private readonly expenseRevision = this.revisions.changeRevision('expenses');
  private readonly paymentRevision = this.revisions.changeRevision('payments');
  private readonly catalogRevision = this.revisions.changeRevision('catalog');
  private readonly inventoryRevision = this.revisions.changeRevision('inventory');
  private lastSalesRevision = 0;
  private lastExpenseRevision = 0;
  private lastPaymentRevision = 0;
  private lastCatalogRevision = 0;
  private lastInventoryRevision = 0;
  private active = false;
  private initialized = false;
  private periodStale = true;
  private yearStale = true;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly initialPeriod = currentMonthBusinessDateRange();
  private periodRequest = 0;
  private yearRequest = 0;

  readonly startDate = signal(this.initialPeriod.startDate);
  readonly endDate = signal(this.initialPeriod.endDate);
  readonly loading = signal(false);
  private readonly metricsState = signal<DashboardMetrics>(EMPTY_METRICS);
  private readonly monthlyRevenueState = signal<MonthlyRevenuePoint[]>(
    Array.from({ length: 12 }, (_, index) => ({
      month: ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'][index] ?? '',
      valueCents: 0,
    })),
  );

  readonly monthlyRevenue = this.monthlyRevenueState.asReadonly();
  readonly chartYear = computed(() => {
    const year = Number(this.endDate().slice(0, 4));
    return Number.isInteger(year) && year > 0 ? year : new Date().getFullYear();
  });
  readonly selectedMonthIndex = computed(() => {
    const year = this.chartYear();
    for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
      const range = businessMonthDateRange(year, monthIndex);
      if (range.startDate === this.startDate() && range.endDate === this.endDate()) {
        return monthIndex;
      }
    }
    return -1;
  });

  readonly revenueCents = computed(() => this.metricsState().revenueCents);
  readonly receivedCents = computed(() => this.metricsState().receivedCents);
  readonly cashReceivedCents = computed(() => this.metricsState().cashReceivedCents);
  readonly receivableCents = computed(() => this.metricsState().receivableCents);
  readonly operationalExpenseCents = computed(() => this.metricsState().operationalExpenseCents);
  readonly cashOutCents = computed(() => this.metricsState().cashOutCents);
  readonly tipsCents = computed(() => this.metricsState().tipsCents);
  readonly cogsCents = computed(() => this.metricsState().cogsCents);
  readonly missingCostItems = computed(() => this.metricsState().missingCostItems);
  readonly saleCount = computed(() => this.metricsState().saleCount);
  readonly itemsSold = computed(() => this.metricsState().itemsSold);
  readonly overdueCount = computed(() => this.metricsState().overdueCount);
  readonly negativeProducts = computed(() => this.metricsState().negativeProducts);
  readonly lowStockProducts = computed(() => this.metricsState().lowStockProducts);
  readonly lowStockInputs = computed(() => this.metricsState().lowStockInputs);
  readonly averageTicketCents = computed(() =>
    this.saleCount() ? Math.round(this.revenueCents() / this.saleCount()) : 0
  );
  readonly cashFlowCents = computed(() => this.cashReceivedCents() - this.cashOutCents());
  readonly resultCents = computed(() =>
    this.revenueCents() + this.tipsCents() - this.cogsCents() - this.operationalExpenseCents()
  );

  constructor() {
    effect(() => {
      const revision = this.salesRevision();
      if (revision === this.lastSalesRevision) return;
      this.lastSalesRevision = revision;
      this.periodStale = true;
      this.yearStale = true;
      this.scheduleRefresh();
    });
    effect(() => {
      const expenses = this.expenseRevision();
      const payments = this.paymentRevision();
      const catalog = this.catalogRevision();
      const inventory = this.inventoryRevision();
      const changed =
        expenses !== this.lastExpenseRevision ||
        payments !== this.lastPaymentRevision ||
        catalog !== this.lastCatalogRevision ||
        inventory !== this.lastInventoryRevision;
      this.lastExpenseRevision = expenses;
      this.lastPaymentRevision = payments;
      this.lastCatalogRevision = catalog;
      this.lastInventoryRevision = inventory;
      if (!changed) return;
      this.periodStale = true;
      this.scheduleRefresh();
    });
  }

  async load(): Promise<void> {
    this.active = true;
    this.loading.set(true);
    try {
      // Compatibility backfill is opportunistic; dashboard reads have a safe legacy fallback.
      void this.backfill.ensure().catch(() => undefined);
      const tasks: Promise<void>[] = [];
      if (!this.initialized || this.periodStale) tasks.push(this.refreshPeriod());
      if (!this.initialized || this.yearStale) tasks.push(this.refreshYear());
      await Promise.all(tasks);
      this.initialized = true;
    } catch (error) {
      this.toast.error(this.errors.message(error));
    } finally {
      this.loading.set(false);
    }
  }

  deactivate(): void {
    this.active = false;
    if (this.refreshTimer !== null) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  async setStartDate(value: string): Promise<void> {
    if (!value || value === this.startDate()) return;
    this.startDate.set(value);
    await this.safeRefreshPeriod();
  }

  async setEndDate(value: string): Promise<void> {
    if (!value || value === this.endDate()) return;
    const previousYear = this.chartYear();
    this.endDate.set(value);
    await Promise.all([
      this.safeRefreshPeriod(),
      previousYear === this.chartYear() ? Promise.resolve() : this.safeRefreshYear(),
    ]);
  }

  async selectMonth(monthIndex: number): Promise<void> {
    const range = businessMonthDateRange(this.chartYear(), monthIndex);
    this.startDate.set(range.startDate);
    this.endDate.set(range.endDate);
    await this.safeRefreshPeriod();
  }

  private scheduleRefresh(): void {
    if (!this.active || !this.initialized || this.refreshTimer !== null) return;
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      if (!this.active) return;
      const tasks: Promise<void>[] = [];
      if (this.periodStale) tasks.push(this.safeRefreshPeriod());
      if (this.yearStale) tasks.push(this.safeRefreshYear());
      void Promise.all(tasks);
    }, 0);
  }

  private async safeRefreshPeriod(): Promise<void> {
    try {
      await this.refreshPeriod();
    } catch (error) {
      this.toast.error(this.errors.message(error));
    }
  }

  private async safeRefreshYear(): Promise<void> {
    try {
      await this.refreshYear();
    } catch (error) {
      this.toast.error(this.errors.message(error));
    }
  }

  private async refreshPeriod(): Promise<void> {
    this.periodStale = true;
    const request = ++this.periodRequest;
    const metrics = await this.repository.metrics(
      this.startDate(),
      this.endDate(),
      todayBusinessDate(),
    );
    if (request === this.periodRequest) {
      this.metricsState.set(metrics);
      this.periodStale = false;
    }
  }

  private async refreshYear(): Promise<void> {
    this.yearStale = true;
    const request = ++this.yearRequest;
    const points = await this.repository.monthlyRevenue(this.chartYear());
    if (request === this.yearRequest) {
      this.monthlyRevenueState.set(points);
      this.yearStale = false;
    }
  }
}
