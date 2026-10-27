import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { AggregateField, FieldPath, getFirestore } from 'firebase-admin/firestore';

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
  // Exercise the exact index shapes introduced in v1.1. Firestore rules
  // emulators don't require composite indexes, so pre-deploy must catch them.
  ['history:customer-prefix-and-period', () => db.collection('sales')
    .where('customerSearchPrefixes', 'array-contains', 'cl')
    .where('businessDate', '>=', startDate).where('businessDate', '<=', endDate)
    .orderBy('businessDate', 'desc').orderBy(FieldPath.documentId(), 'desc').limit(1).get()],
  ['history:product-and-period', () => db.collection('sales')
    .where('productIds', 'array-contains', 'sample-product')
    .where('businessDate', '>=', startDate).where('businessDate', '<=', endDate)
    .orderBy('businessDate', 'desc').orderBy(FieldPath.documentId(), 'desc').limit(1).get()],
  ['history:payment-status-and-period', () => db.collection('sales')
    .where('paymentStatus', '==', 'paid')
    .where('businessDate', '>=', startDate).where('businessDate', '<=', endDate)
    .orderBy('businessDate', 'desc').orderBy(FieldPath.documentId(), 'desc').limit(1).get()],
  ['history:open-and-period', () => db.collection('sales')
    .where('paymentStatus', 'in', ['pending','partial'])
    .where('businessDate', '>=', startDate).where('businessDate', '<=', endDate)
    .orderBy('businessDate', 'desc').orderBy(FieldPath.documentId(), 'desc').limit(1).get()],
  ...['sales','payments','expenses'].map(name => [
    'reports:dated-'+name,
    () => db.collection(name).where('businessDate', '>=', startDate)
      .where('businessDate', '<=', endDate)
      .orderBy('businessDate', 'desc').orderBy(FieldPath.documentId(), 'desc').limit(1).get(),
  ]),
  // The annual revenue chart uses a *single* sum(totalCents) for each month.
  // The multi-aggregate index below cannot necessarily serve this separate shape:
  // an additional discountCents field precedes totalCents in that index.
  // Exercising the exact chart query prevents PROD-only failed-precondition 400s.
  ['dashboard:monthly-revenue-single-sum', () => db.collection('sales')
    .where('status', '==', 'active')
    .where('businessDate', '>=', startDate)
    .where('businessDate', '<=', endDate)
    .aggregate({ revenueCents: AggregateField.sum('totalCents') }).get()],
  ['dashboard:sales-period', () => db.collection('sales')
    .where('status', '==', 'active')
    .where('businessDate', '>=', startDate)
    .where('businessDate', '<=', endDate)
    .aggregate({
      revenueCents: AggregateField.sum('totalCents'),
      discountsCents: AggregateField.sum('discountCents'),
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
    .aggregate({ cashOutCents: AggregateField.sum('bankDebitCents') }).get()],
  // Keep pre-deploy probes identical to the client queries. A legacy-only
  // check previously missed the new fundingType aggregation index entirely.
  ['dashboard:personal-funding-modern', () => db.collection('expenses')
    .where('fundingType', '==', 'third-party')
    .aggregate({ value: AggregateField.sum('amountCents') }).get()],
  ['dashboard:personal-funding-legacy', () => db.collection('expenses')
    .where('fundingSource', 'in', ['ewerton', 'maria', 'owner-unassigned'])
    .get()],
  ['finance:input-purchase-bank-debits', () => db.collection('expenses')
    .where('kind', '==', 'input-purchase')
    .where('businessDate', '>=', startDate)
    .where('businessDate', '<=', endDate)
    .aggregate({ value: AggregateField.sum('bankDebitCents') }).get()],
  ['dashboard:operating-expenses-period', () => db.collection('expenses')
    .where('kind', '==', 'operating-expense')
    .where('businessDate', '>=', startDate)
    .where('businessDate', '<=', endDate)
    .aggregate({ operationalExpenseCents: AggregateField.sum('amountCents') }).get()],
  ['dashboard:receivable-total', () => db.collection('sales')
    .aggregate({ receivableCents: AggregateField.sum('balanceCents') }).get()],
  ['dashboard:overdue', () => db.collection('sales')
    .where('status', '==', 'active')
    .where('paymentStatus', 'in', ['pending', 'partial'])
    .where('dueDate', '<', todayDate)
    .aggregate({
      overdueCount: AggregateField.count(),
      overdueCents: AggregateField.sum('balanceCents'),
    }).get()],
  ['dashboard:pending-orders', () => db.collection('sales')
    .where('status', '==', 'active')
    .where('fulfillmentStatus', 'in', ['in-production', 'ready'])
    .aggregate({ value: AggregateField.count() }).get()],
  ['dashboard:products-status-completeness', () => db.collection('products')
    .where('stockStatus', 'in', ['negative', 'low', 'ok'])
    .aggregate({ value: AggregateField.count() }).get()],
  ['dashboard:inputs-status-completeness', () => db.collection('inputs')
    .where('stockStatus', 'in', ['negative', 'low', 'ok', 'untracked'])
    .aggregate({ value: AggregateField.count() }).get()],
  ['dashboard:low-products', () => db.collection('products')
    .where('active', '==', true)
    .where('stockStatus', '==', 'low')
    .aggregate({ value: AggregateField.count() }).get()],
  ['dashboard:low-inputs', () => db.collection('inputs')
    .where('active', '==', true)
    .where('stockStatus', '==', 'low')
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
