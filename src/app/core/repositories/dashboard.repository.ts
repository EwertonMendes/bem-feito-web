import { inject, Injectable } from '@angular/core';
import {
  collection,
  count,
  getAggregateFromServer,
  getDocs,
  query,
  sum,
  where,
} from 'firebase/firestore';
import { summarizeSaleItems } from '../../domain/logic/sale-analytics';
import { stockStatusForInput, stockStatusForProduct } from '../../domain/logic/stock-status';
import { InputItem, Product } from '../../domain/models/catalog.model';
import { Sale } from '../../domain/models/sales.model';
import { FIRESTORE } from '../firebase/firebase.providers';
import { businessMonthDateRange } from '../utils/date';

export interface DashboardMetrics {
  revenueCents: number;
  receivedCents: number;
  cashReceivedCents: number;
  receivableCents: number;
  operationalExpenseCents: number;
  cashOutCents: number;
  tipsCents: number;
  discountsCents: number;
  overdueCents: number;
  cogsCents: number;
  missingCostItems: number;
  saleCount: number;
  itemsSold: number;
  overdueCount: number;
  lowStockProducts: number;
  lowStockInputs: number;
}

export interface MonthlyRevenuePoint {
  month: string;
  valueCents: number;
}

@Injectable({ providedIn: 'root' })
export class DashboardRepository {
  private readonly firestore = inject(FIRESTORE);

  async metrics(startDate: string, endDate: string, today: string): Promise<DashboardMetrics> {
    const salesInPeriod = query(
      collection(this.firestore, 'sales'),
      where('status', '==', 'active'),
      where('businessDate', '>=', startDate),
      where('businessDate', '<=', endDate),
    );
    const optimizedSalesInPeriod = query(
      collection(this.firestore, 'sales'),
      where('status', '==', 'active'),
      where('analyticsVersion', '==', 1),
      where('businessDate', '>=', startDate),
      where('businessDate', '<=', endDate),
    );
    const paymentsInPeriod = query(
      collection(this.firestore, 'payments'),
      where('status', '==', 'active'),
      where('businessDate', '>=', startDate),
      where('businessDate', '<=', endDate),
    );
    const expensesInPeriod = query(
      collection(this.firestore, 'expenses'),
      where('businessDate', '>=', startDate),
      where('businessDate', '<=', endDate),
    );
    const operatingExpensesInPeriod = query(
      collection(this.firestore, 'expenses'),
      where('kind', '==', 'operating-expense'),
      where('businessDate', '>=', startDate),
      where('businessDate', '<=', endDate),
    );
    // Cancelled sales are persisted with balanceCents = 0, so summing all sales is
    // equivalent and avoids an unnecessary status + balance composite index.
    const allSales = collection(this.firestore, 'sales');
    const overdueSales = query(
      collection(this.firestore, 'sales'),
      where('status', '==', 'active'),
      where('paymentStatus', 'in', ['pending', 'partial']),
      where('dueDate', '<', today),
    );

    const [
      salesAggregate,
      optimizedAggregate,
      paymentsAggregate,
      expensesAggregate,
      operatingExpensesAggregate,
      receivableAggregate,
      overdueAggregate,
      stockAlerts,
    ] = await Promise.all([
      getAggregateFromServer(salesInPeriod, {
        revenueCents: sum('totalCents'),
        discountsCents: sum('discountCents'),
        saleCount: count(),
      }),
      getAggregateFromServer(optimizedSalesInPeriod, {
        optimizedCount: count(),
        cogsCents: sum('cogsCents'),
        itemsSold: sum('itemsSold'),
        missingCostItems: sum('missingCostItems'),
      }),
      getAggregateFromServer(paymentsInPeriod, {
        receivedCents: sum('appliedCents'),
        cashReceivedCents: sum('amountReceivedCents'),
        tipsCents: sum('tipCents'),
      }),
      getAggregateFromServer(expensesInPeriod, {
        cashOutCents: sum('amountCents'),
      }),
      getAggregateFromServer(operatingExpensesInPeriod, {
        operationalExpenseCents: sum('amountCents'),
      }),
      getAggregateFromServer(allSales, {
        receivableCents: sum('balanceCents'),
      }),
      getAggregateFromServer(overdueSales, {
        overdueCount: count(),
        overdueCents: sum('balanceCents'),
      }),
      this.stockAlerts(),
    ]);

    const salesData = salesAggregate.data();
    const optimizedData = optimizedAggregate.data();
    const saleCount = Number(salesData.saleCount ?? 0);
    let cogsCents = Number(optimizedData.cogsCents ?? 0);
    let itemsSold = Number(optimizedData.itemsSold ?? 0);
    let missingCostItems = Number(optimizedData.missingCostItems ?? 0);

    if (Number(optimizedData.optimizedCount ?? 0) < saleCount) {
      // Recompute the whole period when legacy rows exist. The backfill can finish between
      // the aggregate and this read; resetting first makes that race deterministic.
      const snapshot = await getDocs(salesInPeriod);
      cogsCents = 0;
      itemsSold = 0;
      missingCostItems = 0;
      for (const saleSnapshot of snapshot.docs) {
        const sale = { id: saleSnapshot.id, ...saleSnapshot.data() } as Sale;
        const analytics = sale.analyticsVersion === 1
          ? {
              cogsCents: Number(sale.cogsCents ?? 0),
              itemsSold: Number(sale.itemsSold ?? 0),
              missingCostItems: Number(sale.missingCostItems ?? 0),
            }
          : summarizeSaleItems(sale.items);
        cogsCents += analytics.cogsCents;
        itemsSold += analytics.itemsSold;
        missingCostItems += analytics.missingCostItems;
      }
    }

    const paymentsData = paymentsAggregate.data();
    const expensesData = expensesAggregate.data();
    const operatingExpensesData = operatingExpensesAggregate.data();

    return {
      revenueCents: Number(salesData.revenueCents ?? 0),
      receivedCents: Number(paymentsData.receivedCents ?? 0),
      cashReceivedCents: Number(paymentsData.cashReceivedCents ?? 0),
      receivableCents: Number(receivableAggregate.data().receivableCents ?? 0),
      operationalExpenseCents: Number(operatingExpensesData.operationalExpenseCents ?? 0),
      cashOutCents: Number(expensesData.cashOutCents ?? 0),
      tipsCents: Number(paymentsData.tipsCents ?? 0),
      discountsCents: Number(salesData.discountsCents ?? 0),
      overdueCents: Number(overdueAggregate.data().overdueCents ?? 0),
      cogsCents,
      missingCostItems,
      saleCount,
      itemsSold,
      overdueCount: Number(overdueAggregate.data().overdueCount ?? 0),
      ...stockAlerts,
    };
  }

  async monthlyRevenue(year: number): Promise<MonthlyRevenuePoint[]> {
    const labels = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

    return Promise.all(Array.from({ length: 12 }, async (_, monthIndex) => {
      const range = businessMonthDateRange(year, monthIndex);
      const sales = query(
        collection(this.firestore, 'sales'),
        where('status', '==', 'active'),
        where('businessDate', '>=', range.startDate),
        where('businessDate', '<=', range.endDate),
      );
      const aggregate = await getAggregateFromServer(sales, {
        revenueCents: sum('totalCents'),
      });
      return {
        month: labels[monthIndex] ?? '',
        valueCents: Number(aggregate.data().revenueCents ?? 0),
      };
    }));
  }

  private async stockAlerts(): Promise<Pick<
    DashboardMetrics,
    'lowStockProducts' | 'lowStockInputs'
  >> {
    const products = collection(this.firestore, 'products');
    const inputs = collection(this.firestore, 'inputs');

    const [
      productTotal,
      productOptimized,
      inputTotal,
      inputOptimized,
      lowStockProducts,
      lowStockInputs,
    ] = await Promise.all([
      getAggregateFromServer(products, { value: count() }),
      getAggregateFromServer(
        query(products, where('stockStatus', 'in', ['negative', 'low', 'ok'])),
        { value: count() },
      ),
      getAggregateFromServer(inputs, { value: count() }),
      getAggregateFromServer(
        query(inputs, where('stockStatus', 'in', ['negative', 'low', 'ok', 'untracked'])),
        { value: count() },
      ),
      getAggregateFromServer(query(products, where('active', '==', true), where('stockStatus', '==', 'low')), { value: count() }),
      getAggregateFromServer(query(inputs, where('active', '==', true), where('stockStatus', '==', 'low')), { value: count() }),
    ]);

    const productsComplete = Number(productOptimized.data().value ?? 0) === Number(productTotal.data().value ?? 0);
    const inputsComplete = Number(inputOptimized.data().value ?? 0) === Number(inputTotal.data().value ?? 0);

    if (productsComplete && inputsComplete) {
      return {
        lowStockProducts: Number(lowStockProducts.data().value ?? 0),
        lowStockInputs: Number(lowStockInputs.data().value ?? 0),
      };
    }

    const [productSnapshot, inputSnapshot] = await Promise.all([
      getDocs(products),
      getDocs(inputs),
    ]);
    let lowProducts = 0;
    let lowInputs = 0;

    for (const snapshot of productSnapshot.docs) {
      const product = { id: snapshot.id, ...snapshot.data() } as Product;
      const status = stockStatusForProduct(product);
      if (product.active && status === 'low') lowProducts += 1;
    }

    for (const snapshot of inputSnapshot.docs) {
      const input = { id: snapshot.id, ...snapshot.data() } as InputItem;
      if (input.active && stockStatusForInput(input) === 'low') lowInputs += 1;
    }

    return {
      lowStockProducts: lowProducts,
      lowStockInputs: lowInputs,
    };
  }
}
