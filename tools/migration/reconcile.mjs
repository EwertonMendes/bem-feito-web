import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const dataPath = resolve(args[0] ?? 'tools/migration/migration-data.json');
const startDate = args[1] ?? '2026-09-02';
const endDate = args[2] ?? '2026-10-01';
const expectedPath = args[3] ? resolve(args[3]) : null;
const data = JSON.parse(await readFile(dataPath, 'utf8'));

const list = (name) => Array.isArray(data[name]) ? data[name] : [];
const activeSales = list('sales').filter((sale) => sale.status === 'active');
const periodSales = activeSales.filter((sale) => sale.businessDate >= startDate && sale.businessDate <= endDate);
const periodPayments = list('payments').filter(
  (payment) => payment.status === 'active' && payment.businessDate >= startDate && payment.businessDate <= endDate
);
const periodExpenses = list('expenses').filter(
  (expense) => expense.businessDate >= startDate && expense.businessDate <= endDate
);

const physicalItems = (sale) => (sale.items ?? []).reduce((sum, item) => {
  if (item.kind === 'product') return sum + Number(item.quantity ?? 0);
  if (item.kind === 'kit') {
    return sum + (item.components ?? []).reduce((inner, component) => inner + Number(component.quantity ?? 0), 0);
  }
  return sum;
}, 0);

const report = {
  period: { startDate, endDate },
  counts: {
    sales: list('sales').length,
    activeSales: activeSales.length,
    openSales: activeSales.filter((sale) => Number(sale.balanceCents ?? 0) > 0).length,
    products: list('products').length,
    inputs: list('inputs').length,
    payments: list('payments').length,
    productions: list('productions').length,
    expenses: list('expenses').length,
  },
  dashboard: {
    revenueCents: periodSales.reduce((sum, sale) => sum + Number(sale.totalCents ?? 0), 0),
    receivedCents: periodPayments.reduce((sum, payment) => sum + Number(payment.appliedCents ?? 0), 0),
    receivableCents: activeSales.reduce((sum, sale) => sum + Number(sale.balanceCents ?? 0), 0),
    saleCount: periodSales.length,
    cogsKnownCents: periodSales.reduce(
      (sum, sale) => sum + (sale.items ?? []).reduce((inner, item) => inner + Number(item.totalCostCents ?? 0), 0),
      0
    ),
    operationalExpensesCents: periodExpenses
      .filter((expense) => expense.kind === 'operating-expense')
      .reduce((sum, expense) => sum + Number(expense.amountCents ?? 0), 0),
    cashOutCents: periodExpenses.reduce((sum, expense) => sum + Number(expense.amountCents ?? 0), 0),
    cashFlowCents:
      periodPayments.reduce((sum, payment) => sum + Number(payment.amountReceivedCents ?? 0), 0)
      - periodExpenses.reduce((sum, expense) => sum + Number(expense.amountCents ?? 0), 0),
    itemsSold: periodSales.reduce((sum, sale) => sum + physicalItems(sale), 0),
    averageTicketCents: periodSales.length
      ? Math.round(periodSales.reduce((sum, sale) => sum + Number(sale.totalCents ?? 0), 0) / periodSales.length)
      : 0,
    missingCostItems: periodSales.reduce(
      (sum, sale) => sum + (sale.items ?? []).filter((item) => item.kind !== 'addition' && Number(item.totalCostCents ?? 0) <= 0).length,
      0
    ),
    tipsCents: periodSales.reduce((sum, sale) => sum + Number(sale.tipCents ?? 0), 0),
  },
  stock: {
    negativeProducts: list('products').filter((item) => Number(item.stock ?? 0) < 0).length,
    lowProducts: list('products').filter(
      (item) => item.active && Number(item.stock ?? 0) <= Number(item.minimumStock ?? 0)
    ).length,
    lowInputs: list('inputs').filter(
      (item) => item.active && Number(item.stock ?? 0) <= Number(item.minimumStock ?? 0)
    ).length,
    productsWithoutCost: list('products').filter((item) => item.active && !Number(item.averageUnitCostCents ?? 0)).length,
    inputsWithoutCost: list('inputs').filter((item) => item.active && !Number(item.averageUnitCostCents ?? 0)).length,
  },
};

console.log(JSON.stringify(report, null, 2));

if (expectedPath) {
  const expected = JSON.parse(await readFile(expectedPath, 'utf8'));
  const mismatches = [];
  for (const [section, values] of Object.entries(expected)) {
    if (!values || typeof values !== 'object') continue;
    for (const [key, expectedValue] of Object.entries(values)) {
      const actualValue = report[section]?.[key];
      if (actualValue !== expectedValue) {
        mismatches.push(`${section}.${key}: esperado ${expectedValue}, encontrado ${actualValue}`);
      }
    }
  }
  if (mismatches.length) {
    console.error('\nReconciliação falhou:');
    mismatches.forEach((item) => console.error(`- ${item}`));
    process.exitCode = 1;
  } else {
    console.log('\nReconciliação concluída sem divergências.');
  }
}
