import { createHash } from 'node:crypto';

export type Environment = 'dev' | 'prod';
export type Payload = Record<string, unknown>;
export type Target = { collection: string; id: string };
export type Change = Target & { action: 'create' | 'update' | 'delete'; expected: Payload | null; values?: Payload };
export type Request = {
  schemaVersion: 1; id: string; environment: Environment; projectId: string;
  operation: 'read' | 'inspect' | 'verify' | 'create' | 'update' | 'delete' | 'batch-update' | 'backup' | 'restore' | 'migrate' | 'revert-test-production';
  targets?: Target[]; changes?: Change[]; backup?: string; migration?: 'legacy-sheets-v1';
  deploymentSha?: string; destructive?: { projectId: string; paths: string[] };
};

export const BUSINESS_COLLECTIONS = [
  'collections', 'fragrances', 'formats', 'formatPrices', 'units', 'paymentMethods',
  'expenseCategories', 'expenseTypes', 'inputs', 'products', 'kits', 'additions',
  'expenses', 'productions', 'sales', 'payments', 'stockAdjustments', 'stockMovements', 'counters',
] as const;
export const MIGRATION_COLLECTIONS = [...BUSINESS_COLLECTIONS, 'migrationRuns', 'migrationSources'];
const READABLE = new Set<string>([...MIGRATION_COLLECTIONS, 'dataAdminSmoke']);
const FIELD_TYPES: Record<string, Record<string, 'text' | 'id' | 'money' | 'boolean'>> = {
  collections: { name: 'text', active: 'boolean' },
  fragrances: { name: 'text', active: 'boolean', collectionId: 'id' },
  formats: { name: 'text', active: 'boolean' },
  units: { name: 'text', active: 'boolean' },
  paymentMethods: { name: 'text', active: 'boolean' },
  expenseCategories: { name: 'text', active: 'boolean' },
  formatPrices: { collectionId: 'id', formatId: 'id', priceCents: 'money', active: 'boolean' },
  inputs: { averageUnitCostCents: 'money' },
  products: { salePriceCents: 'money', additionalCostCents: 'money' },
  kits: { priceCents: 'money' },
  additions: { priceCents: 'money' },
  dataAdminSmoke: { value: 'money' },
};
export function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
export function object(value: unknown): asserts value is Payload {
  invariant(value !== null && typeof value === 'object' && !Array.isArray(value), 'Expected an object');
  invariant(Object.keys(value).every(k => !['__proto__', 'constructor', 'prototype'].includes(k)), 'Unsafe object key');
}
function exact(value: Payload, keys: string[]) {
  invariant(Object.keys(value).every(k => keys.includes(k)), 'Unexpected schema field');
}
export function identifier(value: unknown): asserts value is string {
  invariant(typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(value), 'Invalid identifier');
}
export function sha(value: unknown): asserts value is string {
  invariant(typeof value === 'string' && /^[a-f0-9]{40}$/.test(value), 'Expected immutable commit SHA');
}
export function digest(value: unknown): asserts value is string {
  invariant(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value), 'Expected SHA-256');
}
function target(value: unknown): asserts value is Target {
  object(value); exact(value, ['collection', 'id']);
  invariant(typeof value.collection === 'string' && READABLE.has(value.collection), 'Collection not allowed');
  identifier(value.id);
  if (value.collection === 'dataAdminSmoke') invariant(value.id.startsWith('smoke-'), 'Smoke namespace required');
}
function fields(collection: string, value: unknown) {
  object(value); const types = FIELD_TYPES[collection];
  invariant(types && Object.keys(value).length > 0, 'No editable fields for collection');
  exact(value, Object.keys(types));
  for (const [name, field] of Object.entries(value)) {
    switch (types[name]) {
      case 'id': identifier(field); break;
      case 'text': invariant(typeof field === 'string' && field.trim().length > 0 && field.length <= 120 && !/[\x00-\x1f]/.test(field), 'Invalid catalog text'); break;
      case 'money': invariant(Number.isSafeInteger(field) && Number(field) >= 0 && Number(field) <= 1_000_000_000, 'Invalid money in integer cents'); break;
      case 'boolean': invariant(typeof field === 'boolean', 'Invalid boolean'); break;
    }
  }
}
export function validateRequest(value: unknown): Request {
  object(value);
  exact(value, ['schemaVersion', 'id', 'environment', 'projectId', 'operation', 'targets', 'changes', 'backup', 'migration', 'deploymentSha', 'destructive']);
  invariant(value.schemaVersion === 1, 'Unknown schema version'); identifier(value.id);
  invariant(['dev', 'prod'].includes(String(value.environment)), 'Unknown environment');
  invariant(typeof value.projectId === 'string' && /^[a-z][a-z0-9-]{5,29}$/.test(value.projectId), 'Invalid project ID');
  const operations = ['read', 'inspect', 'verify', 'create', 'update', 'delete', 'batch-update', 'backup', 'restore', 'migrate', 'revert-test-production'];
  invariant(operations.includes(String(value.operation)), 'Operation not allowed');
  const op = String(value.operation);
  if (['read', 'inspect', 'verify', 'backup'].includes(op)) {
    invariant(Array.isArray(value.targets) && value.targets.length > 0 && value.targets.length <= 200, 'Expected 1..200 explicit targets');
    value.targets.forEach(target);
    invariant(value.changes === undefined && value.backup === undefined && value.migration === undefined && value.deploymentSha === undefined && value.destructive === undefined, 'Incompatible operation fields');
  } else if (op === 'restore') {
    digest(value.backup);
    invariant(value.targets === undefined && value.changes === undefined && value.migration === undefined && value.deploymentSha === undefined, 'Incompatible restore fields');
  } else if (op === 'revert-test-production') {
    invariant(value.environment === 'dev' && value.projectId === 'bem-feito-dev', 'DEV-only test reversal');
    invariant(Array.isArray(value.targets) && value.targets.length === 1, 'Exactly one production target required');
    value.targets.forEach(target);
    invariant(value.targets[0].collection === 'productions' && value.targets[0].id === 'vz7mI3n8Yw6f0WUQ97nO', 'Unregistered production reversal');
    invariant(value.changes === undefined && value.backup === undefined && value.migration === undefined && value.deploymentSha === undefined, 'Incompatible correction fields');
  } else if (op === 'migrate') {
    invariant(value.environment === 'dev' && value.projectId === 'bem-feito-dev', 'Migration is DEV only');
    invariant(value.migration === 'legacy-sheets-v1', 'Unknown registered migration'); sha(value.deploymentSha);
    invariant(value.changes === undefined && value.targets === undefined && value.backup === undefined, 'Migration accepts no code or custom data');
  } else {
    invariant(Array.isArray(value.changes) && value.changes.length > 0 && value.changes.length <= 200, 'Expected 1..200 changes');
    if (op !== 'batch-update') invariant(value.changes.length === 1, 'Single operation requires one change');
    for (const item of value.changes) {
      object(item); exact(item, ['collection', 'id', 'action', 'expected', 'values']);
      target({ collection: item.collection, id: item.id });
      invariant(item.action === (op === 'batch-update' ? 'update' : op), 'Action differs from operation');
      const collection = String(item.collection);
      if (item.action === 'create') {
        invariant(item.expected === null, 'Create requires expected:null'); fields(collection, item.values);
        invariant(['collections', 'fragrances', 'formats', 'units', 'paymentMethods', 'expenseCategories', 'formatPrices', 'dataAdminSmoke'].includes(collection), 'Create requires a registered domain operation');
        invariant(Object.keys(FIELD_TYPES[collection]).every(k => Object.hasOwn(item.values as Payload, k)), 'Incomplete create');
      } else {
        fields(collection, item.expected);
        if (item.action === 'delete') {
          invariant(collection === 'dataAdminSmoke', 'Business deletion requires the registered DEV replacement migration');
          invariant(item.values === undefined, 'Delete accepts no values');
        } else {
          fields(collection, item.values);
          invariant(Object.keys(item.values as Payload).every(k => Object.hasOwn(item.expected as Payload, k)), 'Every changed field needs an expected value');
        }
      }
    }
    invariant(value.targets === undefined && value.backup === undefined && value.migration === undefined && value.deploymentSha === undefined, 'Incompatible change fields');
  }
  if (value.destructive !== undefined) {
    object(value.destructive); exact(value.destructive, ['projectId', 'paths']);
    invariant(value.destructive.projectId === value.projectId, 'Destructive project confirmation differs');
    invariant(Array.isArray(value.destructive.paths) && value.destructive.paths.length > 0 && value.destructive.paths.every(p => typeof p === 'string' && /^[A-Za-z][A-Za-z0-9]*(\/[A-Za-z0-9][A-Za-z0-9_-]{0,99})?$/.test(p)), 'Invalid destructive scope');
    invariant(['delete', 'migrate', 'restore', 'revert-test-production'].includes(op), 'Unneeded destructive confirmation');
  }
  if (['delete', 'migrate', 'restore', 'revert-test-production'].includes(op)) invariant(value.destructive !== undefined, 'Explicit destructive project and scope required');
  const paths = ((value.targets ?? value.changes ?? []) as Target[]).map(p => p.collection + '/' + p.id);
  invariant(new Set(paths).size === paths.length, 'Duplicate target');
  return value as Request;
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical((value as Payload)[k])).join(',') + '}';
  invariant(value !== undefined && !(typeof value === 'number' && !Number.isFinite(value)), 'Non-JSON value');
  return JSON.stringify(value);
}
export const hash = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
export const requestHash = (request: Request) => hash(request);
export function assertDestination(request: Request, config: any) {
  const env = config.environments[request.environment];
  invariant(env && env.projectId === request.projectId, 'Environment is unconfigured or project differs');
  invariant(request.environment !== 'prod' || request.projectId !== config.environments.dev.projectId, 'DEV/PROD must be isolated');
  return env;
}
export function assertScope(request: Request, paths: string[]) {
  if (!request.destructive) return;
  const scope = [...request.destructive.paths].sort();
  invariant(new Set(scope).size === scope.length && canonical(scope) === canonical([...paths].sort()), 'Destructive scope differs from exact operation scope');
}
// Business values, including individual financial amounts, stay private in every public report.
export function redact(data: Payload | null, publicNumericKeys: readonly string[] = []): Payload | null {
  if (!data) return null;
  return Object.fromEntries(Object.entries(data).map(([k, v]) => [k, publicNumericKeys.includes(k) && typeof v === 'number' ? v : '[redacted]']));
}
