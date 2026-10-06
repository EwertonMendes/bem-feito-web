import { computed, inject, Injectable, signal } from '@angular/core';
import { Sale } from '../../domain/models/sales.model';
import { FinanceStore } from '../finance/finance.store';
import { SalesStore } from '../sales/sales.store';
import { CatalogStore } from '../catalog/catalog.store';
import { businessMonthDateRange, currentMonthBusinessDateRange, todayBusinessDate } from '../../core/utils/date';

@Injectable({ providedIn: 'root' })
export class DashboardStore {
  private readonly salesStore = inject(SalesStore);
  private readonly financeStore = inject(FinanceStore);
  private readonly catalogStore = inject(CatalogStore);

  private readonly initialPeriod = currentMonthBusinessDateRange();

  readonly startDate = signal(this.initialPeriod.startDate);
  readonly endDate = signal(this.initialPeriod.endDate);
  readonly loading = signal(false);
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

  readonly periodSales = computed(() =>
    this.salesStore.sales().filter((sale) =>
      sale.status === 'active' && sale.businessDate >= this.startDate() && sale.businessDate <= this.endDate()
    )
  );
  readonly periodPayments = computed(() =>
    this.financeStore.payments().filter((payment) =>
      payment.status === 'active' && payment.businessDate >= this.startDate() && payment.businessDate <= this.endDate()
    )
  );
  readonly periodExpenses = computed(() =>
    this.financeStore.expenses().filter((expense) =>
      expense.businessDate >= this.startDate() && expense.businessDate <= this.endDate()
    )
  );

  readonly revenueCents = computed(() => this.periodSales().reduce((sum, sale) => sum + sale.totalCents, 0));
  readonly receivedCents = computed(() => this.periodPayments().reduce((sum, payment) => sum + payment.appliedCents, 0));
  readonly cashReceivedCents = computed(() => this.periodPayments().reduce((sum, payment) => sum + payment.amountReceivedCents, 0));
  readonly receivableCents = computed(() => this.salesStore.sales().filter((sale) => sale.status === 'active').reduce((sum, sale) => sum + sale.balanceCents, 0));
  readonly operationalExpenseCents = computed(() => this.periodExpenses().filter((expense) => expense.kind === 'operating-expense').reduce((sum, expense) => sum + expense.amountCents, 0));
  readonly cashOutCents = computed(() => this.periodExpenses().reduce((sum, expense) => sum + expense.amountCents, 0));
  readonly cashFlowCents = computed(() => this.cashReceivedCents() - this.cashOutCents());
  readonly tipsCents = computed(() => this.periodPayments().reduce((sum, payment) => sum + payment.tipCents, 0));
  readonly cogsCents = computed(() => this.periodSales().reduce((sum, sale) => sum + sale.items.reduce((itemSum, item) => itemSum + item.totalCostCents, 0), 0));
  readonly missingCostItems = computed(() =>
    this.periodSales().reduce((sum, sale) => sum + sale.items.reduce((itemSum, item) => {
      if (item.kind === 'product') return itemSum + (item.totalCostCents <= 0 ? 1 : 0);
      if (item.kind === 'kit') return itemSum + (item.components?.filter((component) => component.unitCostCents <= 0).length ?? 0);
      return itemSum;
    }, 0), 0)
  );
  readonly resultCents = computed(() => this.revenueCents() + this.tipsCents() - this.cogsCents() - this.operationalExpenseCents());
  readonly saleCount = computed(() => this.periodSales().length);
  readonly averageTicketCents = computed(() => this.saleCount() ? Math.round(this.revenueCents() / this.saleCount()) : 0);
  readonly itemsSold = computed(() => this.periodSales().reduce((total, sale) => total + sale.items.reduce((sum, item) => {
    if (item.kind === 'product') return sum + item.quantity;
    if (item.kind === 'kit') return sum + (item.components?.reduce((inner, component) => inner + component.quantity, 0) ?? 0);
    return sum;
  }, 0), 0));
  readonly overdueCount = computed(() => {
    const today = todayBusinessDate();
    return this.salesStore.sales().filter((sale) => sale.status === 'active' && sale.balanceCents > 0 && sale.dueDate && sale.dueDate < today).length;
  });
  readonly monthlyRevenue = computed(() => this.buildMonthly(this.salesStore.sales()));
  readonly lowStockProducts = this.catalogStore.lowStockProducts;
  readonly lowStockInputs = this.catalogStore.lowStockInputs;
  readonly negativeProducts = this.catalogStore.negativeProducts;

  async load(): Promise<void> {
    this.loading.set(true);
    await Promise.all([this.salesStore.load(), this.financeStore.load(), this.catalogStore.load(true)]);
    this.loading.set(false);
  }

  selectMonth(monthIndex: number): void {
    const range = businessMonthDateRange(this.chartYear(), monthIndex);
    this.startDate.set(range.startDate);
    this.endDate.set(range.endDate);
  }

  private buildMonthly(sales: Sale[]): { month: string; valueCents: number }[] {
    const year = this.chartYear();
    return Array.from({ length: 12 }, (_, index) => {
      const prefix = `${year}-${String(index + 1).padStart(2, '0')}`;
      return {
        month: ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'][index] ?? '',
        valueCents: sales.filter((sale) => sale.status === 'active' && sale.businessDate.startsWith(prefix)).reduce((sum, sale) => sum + sale.totalCents, 0),
      };
    });
  }
}
