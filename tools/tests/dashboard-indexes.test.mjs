import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const indexes = JSON.parse(readFileSync('firestore.indexes.json', 'utf8')).indexes;
const equal = (actual, expected) => JSON.stringify(actual) === JSON.stringify(expected);

test('annual dashboard monthly revenue has a standalone indexed sum(totalCents) query', () => {
  const shape = [
    { fieldPath: 'status', order: 'ASCENDING' },
    { fieldPath: 'businessDate', order: 'ASCENDING' },
    { fieldPath: 'totalCents', order: 'ASCENDING' },
  ];
  assert.ok(indexes.some(index =>
    index.collectionGroup === 'sales' &&
    index.queryScope === 'COLLECTION' &&
    equal(index.fields, shape)
  ), 'monthly sum(totalCents) must have its own composite index');
});

test('existing dashboard multi-aggregate indexes are not replaced', () => {
  assert.ok(indexes.some(index =>
    index.collectionGroup === 'sales' &&
    index.fields.some(field => field.fieldPath === 'discountCents') &&
    index.fields.some(field => field.fieldPath === 'totalCents')
  ), 'existing composite index for sales KPIs must remain');
});

test('deployment smoke checks exercise monthly sum(totalCents), not only the multi-aggregate', () => {
  const script = readFileSync('tools/deploy/verify-firestore-queries.mjs', 'utf8');
  assert.match(script, /dashboard:monthly-revenue-single-sum/);
  assert.match(script, /revenueCents:\s*AggregateField\.sum\('totalCents'\)/);
  assert.match(script, /dashboard:sales-period/);
});

test('freight has an independent indexed aggregation without hiding historical sale totals', () => {
  const shape = [
    { fieldPath: 'status', order: 'ASCENDING' },
    { fieldPath: 'businessDate', order: 'ASCENDING' },
    { fieldPath: 'shippingFeeCents', order: 'ASCENDING' },
  ];
  assert.ok(indexes.some(index =>
    index.collectionGroup === 'sales' &&
    index.queryScope === 'COLLECTION' &&
    equal(index.fields, shape)
  ), 'sum(shippingFeeCents) needs its own composite index');

  const source = readFileSync('src/app/core/repositories/dashboard.repository.ts', 'utf8');
  const oldKpi = source.match(/getAggregateFromServer\(salesInPeriod,\s*\{([\s\S]*?)\}\)/)?.[1];
  assert.ok(oldKpi, 'historical sales KPI aggregate must remain');
  assert.ok(!oldKpi.includes('shippingFeeCents'), 'missing freight on older sales must not remove their revenue');
  assert.match(source, /getAggregateFromServer\(salesInPeriod,\s*\{\s*shippingCents:\s*sum\('shippingFeeCents'\)/);
  assert.match(source, /shippingCents:\s*Number\(shippingAggregate\.data\(\)\.shippingCents \?\? 0\)/);

  const probes = readFileSync('tools/deploy/verify-firestore-queries.mjs', 'utf8');
  assert.match(probes, /dashboard:shipping-period-single-sum/);
  assert.match(probes, /shippingCents:\s*AggregateField\.sum\('shippingFeeCents'\)/);
  const oldProbe = probes.match(/\['dashboard:sales-period',[\s\S]*?\}\)\.get\(\)\]/)?.[0];
  assert.ok(oldProbe && !oldProbe.includes('shippingFeeCents'));
});

test('index additions do not introduce duplicates', () => {
  const names = indexes.map(index => JSON.stringify(index));
  assert.equal(new Set(names).size, names.length);
});
