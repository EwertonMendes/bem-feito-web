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
  cogsCents: number;
  missingCostItems: number;
  saleCount: number;
  itemsSold: number;
  overdueCount: number;
  negativeProducts: number;
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
    const activeSales = query(
      collection(this.firestore, 'sales'),
      where('status', '==', 'active'),
    );
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
      getAggregateFromServer(activeSales, {
        receivableCents: sum('balanceCents'),
      }),
      getAggregateFromServer(overdueSales, {
        overdueCount: count(),
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
      const snapshot = await getDocs(salesInPeriod);
      for (const saleSnapshot of snapshot.docs) {
        const sale = { id: saleSnapshot.id, ...saleSnapshot.data() } as Sale;
        if (sale.analyticsVersion === 1) continue;
        const analytics = summarizeSaleItems(sale.items);
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
    'negativeProducts' | 'lowStockProducts' | 'lowStockInputs'
  >> {
    const products = collection(this.firestore, 'products');
    const inputs = collection(this.firestore, 'inputs');

    const [
      productTotal,
      productOptimized,
      inputTotal,
      inputOptimized,
      negativeProducts,
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
      getAggregateFromServer(query(products, where('stockStatus', '==', 'negative')), { value: count() }),
      getAggregateFromServer(query(products, where('active', '==', true), where('stockStatus', 'in', ['negative', 'low'])), { value: count() }),
      getAggregateFromServer(query(inputs, where('active', '==', true), where('stockStatus', 'in', ['negative', 'low'])), { value: count() }),
    ]);

    const productsComplete = Number(productOptimized.data().value ?? 0) === Number(productTotal.data().value ?? 0);
    const inputsComplete = Number(inputOptimized.data().value ?? 0) === Number(inputTotal.data().value ?? 0);

    if (productsComplete && inputsComplete) {
      return {
        negativeProducts: Number(negativeProducts.data().value ?? 0),
        lowStockProducts: Number(lowStockProducts.data().value ?? 0),
        lowStockInputs: Number(lowStockInputs.data().value ?? 0),
      };
    }

    const [productSnapshot, inputSnapshot] = await Promise.all([
      getDocs(products),
      getDocs(inputs),
    ]);
    let negative = 0;
    let lowProducts = 0;
    let lowInputs = 0;

    for (const snapshot of productSnapshot.docs) {
      const product = { id: snapshot.id, ...snapshot.data() } as Product;
      const status = stockStatusForProduct(product);
      if (status === 'negative') negative += 1;
      if (product.active && ['negative', 'low'].includes(status)) lowProducts += 1;
    }

    for (const snapshot of inputSnapshot.docs) {
      const input = { id: snapshot.id, ...snapshot.data() } as InputItem;
      if (input.active && ['negative', 'low'].includes(stockStatusForInput(input))) lowInputs += 1;
    }

    return {
      negativeProducts: negative,
      lowStockProducts: lowProducts,
      lowStockInputs: lowInputs,
    };
  }
}
