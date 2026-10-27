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

test('index additions do not introduce duplicates', () => {
  const names = indexes.map(index => JSON.stringify(index));
  assert.equal(new Set(names).size, names.length);
});
