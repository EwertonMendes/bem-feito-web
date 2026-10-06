import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { AggregateField, getFirestore } from 'firebase-admin/firestore';

const projectId = process.env.GOOGLE_CLOUD_PROJECT?.trim()
  || process.env.GCLOUD_PROJECT?.trim()
  || 'bem-feito-dev';

const app = initializeApp({
  credential: applicationDefault(),
  projectId,
});
const db = getFirestore(app);

const today = new Date();
const year = today.getUTCFullYear();
const month = String(today.getUTCMonth() + 1).padStart(2, '0');
const day = String(today.getUTCDate()).padStart(2, '0');
const startDate = `${year}-${month}-01`;
const endDate = `${year}-${month}-${day}`;
const todayDate = endDate;

const checks = [
  ['dashboard:sales-period', () => db.collection('sales')
    .where('status', '==', 'active')
    .where('businessDate', '>=', startDate)
    .where('businessDate', '<=', endDate)
    .aggregate({
      revenueCents: AggregateField.sum('totalCents'),
      saleCount: AggregateField.count(),
    }).get()],
  ['dashboard:optimized-sales-period', () => db.collection('sales')
    .where('status', '==', 'active')
    .where('analyticsVersion', '==', 1)
    .where('businessDate', '>=', startDate)
    .where('businessDate', '<=', endDate)
    .aggregate({
      optimizedCount: AggregateField.count(),
      cogsCents: AggregateField.sum('cogsCents'),
      itemsSold: AggregateField.sum('itemsSold'),
      missingCostItems: AggregateField.sum('missingCostItems'),
    }).get()],
  ['dashboard:payments-period', () => db.collection('payments')
    .where('status', '==', 'active')
    .where('businessDate', '>=', startDate)
    .where('businessDate', '<=', endDate)
    .aggregate({
      receivedCents: AggregateField.sum('appliedCents'),
      cashReceivedCents: AggregateField.sum('amountReceivedCents'),
      tipsCents: AggregateField.sum('tipCents'),
    }).get()],
  ['dashboard:expenses-period', () => db.collection('expenses')
    .where('businessDate', '>=', startDate)
    .where('businessDate', '<=', endDate)
    .aggregate({ cashOutCents: AggregateField.sum('amountCents') }).get()],
  ['dashboard:operating-expenses-period', () => db.collection('expenses')
    .where('kind', '==', 'operating-expense')
    .where('businessDate', '>=', startDate)
    .where('businessDate', '<=', endDate)
    .aggregate({ operationalExpenseCents: AggregateField.sum('amountCents') }).get()],
  ['dashboard:receivable-total', () => db.collection('sales')
    .aggregate({ receivableCents: AggregateField.sum('balanceCents') }).get()],
  ['dashboard:overdue-count', () => db.collection('sales')
    .where('status', '==', 'active')
    .where('paymentStatus', 'in', ['pending', 'partial'])
    .where('dueDate', '<', todayDate)
    .aggregate({ overdueCount: AggregateField.count() }).get()],
  ['dashboard:products-status-completeness', () => db.collection('products')
    .where('stockStatus', 'in', ['negative', 'low', 'ok'])
    .aggregate({ value: AggregateField.count() }).get()],
  ['dashboard:inputs-status-completeness', () => db.collection('inputs')
    .where('stockStatus', 'in', ['negative', 'low', 'ok', 'untracked'])
    .aggregate({ value: AggregateField.count() }).get()],
  ['dashboard:negative-products', () => db.collection('products')
    .where('stockStatus', '==', 'negative')
    .aggregate({ value: AggregateField.count() }).get()],
  ['dashboard:low-products', () => db.collection('products')
    .where('active', '==', true)
    .where('stockStatus', 'in', ['negative', 'low'])
    .aggregate({ value: AggregateField.count() }).get()],
  ['dashboard:low-inputs', () => db.collection('inputs')
    .where('active', '==', true)
    .where('stockStatus', 'in', ['negative', 'low'])
    .aggregate({ value: AggregateField.count() }).get()],
  ['finance:expenses-total', () => db.collection('expenses')
    .aggregate({ total: AggregateField.sum('amountCents') }).get()],
  ['finance:payment-count', () => db.collection('payments')
    .aggregate({ total: AggregateField.count() }).get()],
];

const failures = [];
for (const [name, execute] of checks) {
  try {
    await execute();
    console.log(`✓ ${name}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`✗ ${name}: ${message}`);
    failures.push({ name, message });
  }
}

if (failures.length) {
  console.error(`Firestore query verification failed for ${failures.length} query path(s).`);
  process.exit(1);
}

console.log(`All ${checks.length} Firestore aggregation query paths are executable in ${projectId}.`);
