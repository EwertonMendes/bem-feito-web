import { type Firestore } from 'firebase-admin/firestore';
import { encode } from './codec.ts';
import { hash, invariant, identifier, requestHash } from './schema.ts';
import type { Request, Payload } from './schema.ts';
import { snapshotRow, type Plan, type Row } from './engine.ts';

type Value = string | number | boolean;
type FieldKind = 'name' | 'bool' | 'money' | 'stock' | 'text';
type DirectAction = 'create' | 'patch' | 'delete' | 'reverseProduction' | 'adjustStock';
export type DirectRequest = {
  schemaVersion: 1; id: string; environment: 'dev'; projectId: 'bem-feito-dev';
  action: DirectAction;
  collection?: string; documentId?: string;
  expected?: Record<string, Value>; values?: Record<string, Value>;
  itemType?: 'product' | 'input'; itemId?: string; quantityDelta?: number;
  reason?: string; businessDate?: string;
};

const FIELDS: Record<string, Record<string, FieldKind>> = {
  collections: { name:'name', active:'bool' },
  fragrances: { name:'name', active:'bool' },
  formats: { name:'name', active:'bool', approximateWeightGrams:'stock' },
  units: { name:'name', active:'bool' },
  paymentMethods: { name:'name', active:'bool' },
  expenseCategories: { name:'name', active:'bool' },
  expenseTypes: { name:'name', active:'bool' },
  formatPrices: { priceCents:'money', active:'bool' },
  products: { displayName:'name', active:'bool', salePriceCents:'money', additionalCostCents:'money', minimumStock:'stock' },
  inputs: { name:'name', active:'bool', minimumStock:'stock', minimumStockConfigured:'bool',
    availabilityStatus:'name', averageUnitCostCents:'money' },
  kits: { name:'name', active:'bool', priceCents:'money' },
  additions: { name:'name', active:'bool', priceCents:'money', category:'name' },
  // Synthetic end-to-end smoke only; no ordinary business document uses this namespace.
  dataAdminSmoke: { value:'money' },
};
const CREATABLE = new Set(['collections','formats','units','paymentMethods','expenseCategories','dataAdminSmoke']);
const DELETABLE = new Set(['dataAdminSmoke','expenseCategories']);
const MAX_PAYLOAD = 10000;
const props = (v: unknown, keys: string[]) => {
  invariant(!!v && typeof v === 'object' && !Array.isArray(v), 'Expected object');
  invariant(Object.keys(v).every(k => keys.includes(k) && !['__proto__','prototype','constructor'].includes(k)), 'Unexpected request property');
  return v as Record<string, unknown>;
};
const validField = (v: unknown, kind: FieldKind) => {
  switch (kind) {
    case 'bool': return typeof v === 'boolean';
    case 'name': return typeof v === 'string' && v.trim().length > 0 && v.length <= 120 &&
      !/[\x00-\x1f]/.test(v) && !/@|\bhttps?:\/\/|(?:\+?\d[\d ()-]{8,}\d)/.test(v);
    case 'text': return typeof v === 'string' && v.length <= 160 && !/[\x00-\x1f]/.test(v);
    case 'money': return Number.isSafeInteger(v) && Number(v) >= 0 && Number(v) <= 1_000_000_000;
    case 'stock': return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1_000_000;
  }
};
const fieldValues = (c: string, value: unknown) => {
  const obj = props(value, Object.keys(FIELDS[c] ?? {}));
  invariant(Object.keys(obj).length > 0, 'No fields to change');
  for (const [k, v] of Object.entries(obj))
    invariant(validField(v,FIELDS[c]![k]!), 'Invalid field or value');
  return obj as Record<string,Value>;
};
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function validateDirectRequest(input: string): DirectRequest {
  invariant(typeof input === 'string' && input.length > 0 && input.length <= MAX_PAYLOAD, 'Invalid direct request size');
  let raw: unknown;
  try { raw = JSON.parse(input); } catch { throw Error('Invalid direct request JSON'); }
  const o = props(raw, ['schemaVersion','id','environment','projectId','action','collection','documentId',
    'expected','values','itemType','itemId','quantityDelta','reason','businessDate']);
  invariant(o.schemaVersion === 1 && o.environment === 'dev' && o.projectId === 'bem-feito-dev',
    'Direct administration is DEV-only');
  identifier(o.id);
  invariant((o.id as string).length <= 80, 'Operation ID too long');
  invariant(['create','patch','delete','reverseProduction','adjustStock'].includes(String(o.action)), 'Unknown direct action');
  const action = o.action;
  if (['create','patch','delete'].includes(String(action))) {
    invariant(typeof o.collection === 'string' && Object.hasOwn(FIELDS,o.collection), 'Collection not editable');
    identifier(o.documentId);
    if (o.collection === 'dataAdminSmoke') invariant(String(o.documentId).startsWith('smoke-'), 'Protected test namespace');
    invariant(['itemType','itemId','quantityDelta','reason','businessDate'].every(k => o[k] === undefined), 'Unexpected stock parameters');
    if (action === 'create') {
      invariant(CREATABLE.has(o.collection as string), 'Create requires registered catalog workflow');
      invariant(o.expected === undefined, 'Create cannot provide preconditions');
      const values = fieldValues(o.collection as string,o.values);
      if (o.collection !== 'dataAdminSmoke') invariant(typeof values.name === 'string' && typeof values.active === 'boolean',
        'Catalog creation requires name and active');
    } else if (action === 'patch') {
      const values = fieldValues(o.collection as string,o.values);
      const expected = fieldValues(o.collection as string,o.expected);
      invariant(Object.keys(values).length === Object.keys(expected).length &&
        Object.keys(values).every(k => Object.hasOwn(expected,k)), 'Patch requires matching expected fields');
    } else {
      invariant(DELETABLE.has(o.collection as string), 'Business deletion requires domain-aware action');
      invariant(o.expected === undefined && o.values === undefined, 'Delete takes no data fields');
    }
  } else if (action === 'reverseProduction') {
    invariant(o.collection === undefined && o.expected === undefined && o.values === undefined &&
      o.itemType === undefined && o.itemId === undefined && o.quantityDelta === undefined &&
      o.reason === undefined && o.businessDate === undefined, 'Unexpected reversal parameters');
    identifier(o.documentId);
  } else {
    invariant(o.collection === undefined && o.documentId === undefined && o.expected === undefined &&
      o.values === undefined, 'Stock adjustment does not accept raw field writes');
    invariant(['product','input'].includes(String(o.itemType)), 'Invalid item type');
    identifier(o.itemId);
    invariant(typeof o.quantityDelta === 'number' && Number.isFinite(o.quantityDelta) &&
      Math.abs(o.quantityDelta) <= 1_000_000 && o.quantityDelta !== 0, 'Invalid stock delta');
    if (o.itemType === 'product') invariant(Number.isSafeInteger(o.quantityDelta), 'Finished goods require integer units');
    invariant(typeof o.reason === 'string' && o.reason.trim().length > 0 &&
      o.reason.length <= 160 && !/[\x00-\x1f]/.test(o.reason), 'Adjustment reason required');
    invariant(typeof o.businessDate === 'string' && DAY.test(o.businessDate) &&
      !Number.isNaN(Date.parse(o.businessDate)), 'Invalid business date');
  }
  return raw as DirectRequest;
}

export function directAsRequest(input: DirectRequest): Request {
  // Existing audited writer uses only the shared operation ID, request hash and DEV scope.
  // Include every validated dispatch parameter in the hash to prevent replay of altered payloads.
  return { ...input, operation: input.action } as unknown as Request;
}

const statusProduct = (stock: number, minimum: number) => stock <= minimum ? 'low' : 'ok';
const statusInput = (d: Payload, stock: number) =>
  d.trackingMode === 'untracked' || d.minimumStockConfigured === false ? 'untracked' :
    stock <= Number(d.minimumStock ?? 0) ? 'low' : 'ok';

async function noDependents(db: Firestore, collection: string, id: string) {
  // Other reference catalogs can appear inside nested kit recipes and cannot be
  // safely hard-deleted without a fully indexed dependency graph.
  if (collection === 'expenseCategories') {
    for (const field of ['categoryId','expenseCategoryId']) {
      const doc = await db.collection('expenses').where(field,'==',id).limit(1).get();
      invariant(doc.empty, 'Expense category is referenced; deactivate instead');
    }
  }
}
function snapshotData(row: Row, data: Payload | null) { row.after = encode(data); }
async function createOrPatchOrDelete(db: Firestore,input: DirectRequest): Promise<Row[]> {
  const path = input.collection + '/' + input.documentId;
  const snap = await db.doc(path).get();
  const row = snapshotRow(snap);
  const before = snap.data() as Payload | undefined;
  if (input.action === 'create') {
    invariant(!snap.exists, 'Document already exists');
    snapshotData(row, input.values!);
  } else {
    invariant(snap.exists && before, 'Document not found');
    if (input.action === 'delete') {
      await noDependents(db,input.collection!,input.documentId!);
      snapshotData(row,null);
    } else {
      for (const [key,value] of Object.entries(input.expected!))
        invariant(hash(encode(before[key])) === hash(encode(value)), 'Field precondition differs');
      const after: Payload = { ...before, ...input.values };
      if (input.collection === 'inputs' && Object.hasOwn(input.values!,'averageUnitCostCents')) {
        const basis = Number(before.costBasisQuantity ?? before.stock ?? 0);
        invariant(Number.isFinite(basis) && basis >= 0 && basis <= 1_000_000, 'Invalid cost basis');
        after.costBasisQuantity = basis;
        after.costBasisValueCents = Math.round(basis * Number(after.averageUnitCostCents));
      }
      if (input.collection === 'products' && Object.hasOwn(input.values!,'minimumStock'))
        after.stockStatus = statusProduct(Number(before.stock),Number(after.minimumStock));
      if (input.collection === 'inputs' &&
        ['minimumStock','minimumStockConfigured'].some(k => Object.hasOwn(input.values!,k)))
        after.stockStatus = statusInput(after,Number(before.stock));
      snapshotData(row,after);
    }
  }
  return [row];
}
const time = (value: any): number => value && typeof value.toMillis === 'function' ? value.toMillis() : NaN;
async function reverseProduction(db: Firestore, productionId: string): Promise<Row[]> {
  const production = await db.doc('productions/' + productionId).get();
  invariant(production.exists, 'Production not found');
  const data = production.data()!;
  const items: any[] = Array.isArray(data.items) && data.items.length
    ? data.items : [{ productId:data.productId, quantity:data.quantity, consumptions:data.consumptions ?? [] }];
  invariant(items.length > 0 && items.length <= 60, 'Invalid production items');
  const expectedProducts = new Map<string,number>();
  const expectedInputs = new Set<string>();
  for (const item of items) {
    identifier(item.productId);
    invariant(Number.isSafeInteger(item.quantity) && item.quantity > 0, 'Invalid production quantity');
    expectedProducts.set(item.productId,(expectedProducts.get(item.productId) ?? 0) + item.quantity);
  }
  for (const c of data.consumptions ?? items.flatMap(i => i.consumptions ?? [])) {
    identifier(c.inputId); expectedInputs.add(c.inputId);
  }
  const movements = await db.collection('stockMovements').where('sourceId','==',productionId).limit(101).get();
  invariant(!movements.empty && movements.size <= 100, 'Missing or excessive production movements');
  const deltas = new Map<string,number>();
  for (const d of movements.docs) {
    const m=d.data();
    invariant(m.sourceType === 'production' && m.businessDate === data.businessDate &&
      ['product','input'].includes(m.itemType), 'Foreign movement shares source ID');
    identifier(m.itemId);
    const path=(m.itemType === 'product' ? 'products/' : 'inputs/') + m.itemId;
    invariant(typeof m.quantityDelta === 'number' && Number.isFinite(m.quantityDelta), 'Invalid movement quantity');
    invariant(m.itemType === 'product' ? m.quantityDelta > 0 && expectedProducts.has(m.itemId)
      : m.quantityDelta < 0 && expectedInputs.has(m.itemId), 'Unexpected production movement');
    deltas.set(path,(deltas.get(path) ?? 0) + m.quantityDelta);
  }
  for (const [id,quantity] of expectedProducts)
    invariant(deltas.get('products/'+id) === quantity, 'Production movement and product quantity differ');
  const snapshots = await db.getAll(...[...deltas.keys()].map(p => db.doc(p)));
  const rows: Row[] = [snapshotRow(production),...movements.docs.map(snapshotRow)];
  snapshotData(rows[0]!,null);
  for (let i=1;i<rows.length;i++) snapshotData(rows[i]!,null);
  for (const item of snapshots) {
    invariant(item.exists, 'Stock item missing');
    const before = item.data()!, path=item.ref.path;
    const delta=deltas.get(path)!;
    const stock = Number(before.stock)-delta;
    invariant(Number.isFinite(stock) && stock >= 0, 'Not enough stock to reverse production');
    if (path.startsWith('products/')) {
      invariant(Number.isSafeInteger(stock) &&
        stock >= Number(before.reservedPhysicalStock ?? 0), 'Production stock is already reserved/consumed');
    }
    // If another movement happened afterwards, its costing/reservation could depend on this
    // production. Never silently rewrite history; require a reviewed business correction.
    const history = await db.collection('stockMovements').where('itemId','==',item.id).limit(101).get();
    invariant(history.size <= 100, 'Movement history too large to reverse safely');
    const own = movements.docs.filter(d => d.data().itemId === item.id);
    const lastOwn = Math.max(...own.map(d => time(d.data().createdAt)));
    invariant(Number.isFinite(lastOwn), 'Missing movement timestamp');
    invariant(history.docs.every(d => d.data().sourceId === productionId ||
      (Number.isFinite(time(d.data().createdAt)) && time(d.data().createdAt) <= lastOwn)),
      'Subsequent stock movement exists; manual reconciliation required');
    const after: Payload = { ...before, stock,
      stockStatus: path.startsWith('products/')
        ? statusProduct(stock,Number(before.minimumStock ?? 0)) : statusInput(before,stock) };
    const row=snapshotRow(item); snapshotData(row,after); rows.push(row);
  }
  return rows;
}
async function adjustStock(db: Firestore, input: DirectRequest): Promise<Row[]> {
  const collection = input.itemType === 'product' ? 'products' : 'inputs';
  const ref=db.doc(collection + '/' + input.itemId);
  const counterRef=db.doc('counters/stockAdjustment');
  const [snap,counter]=await db.getAll(ref,counterRef);
  invariant(snap.exists, 'Stock item not found');
  const before=snap.data()!;
  invariant(input.itemType !== 'input' || before.trackingMode !== 'untracked',
    'Untracked input cannot be adjusted numerically');
  const stock=Number(before.stock) + input.quantityDelta!;
  invariant(Number.isFinite(stock) && stock >= 0 && stock <= 1_000_000 &&
    (input.itemType === 'input' || Number.isSafeInteger(stock)), 'Invalid resulting stock');
  invariant(input.itemType !== 'product' ||
    stock >= Number(before.reservedPhysicalStock ?? 0), 'Cannot remove reserved stock');
  const seq=Number(counter.data()?.value ?? 0)+1;
  invariant(Number.isSafeInteger(seq) && seq > 0, 'Invalid adjustment counter');
  const adjustmentId='admin-'+input.id;
  const movId='admin-'+input.id;
  const aj=db.doc('stockAdjustments/'+adjustmentId);
  const mv=db.doc('stockMovements/'+movId);
  const [oldAj,oldMv]=await db.getAll(aj,mv);
  invariant(!oldAj.exists && !oldMv.exists, 'Adjustment already exists with this operation ID');
  const rows=[snapshotRow(snap),snapshotRow(counter),snapshotRow(oldAj),snapshotRow(oldMv)];
  snapshotData(rows[0]!,{...before,stock,stockStatus:input.itemType === 'product'
    ? statusProduct(stock,Number(before.minimumStock ?? 0)):statusInput(before,stock)});
  snapshotData(rows[1]!,{...(counter.data() ?? {}),value:seq});
  snapshotData(rows[2]!,{code:'AJ'+String(seq).padStart(5,'0'),businessDate:input.businessDate!,
    itemType:input.itemType!,itemId:input.itemId!,quantityDelta:input.quantityDelta!,
    reason:input.reason!.trim()});
  const unitCostCents=Number(before.averageUnitCostCents ?? 0);
  snapshotData(rows[3]!,{itemType:input.itemType!,itemId:input.itemId!,quantityDelta:input.quantityDelta!,
    unitCostCents,totalCostCents:Math.round(Math.abs(input.quantityDelta!)*unitCostCents),
    sourceType:'adjustment',sourceId:adjustmentId,businessDate:input.businessDate!});
  return rows;
}
export async function prepareDirect(input: DirectRequest, db: Firestore): Promise<{request:Request;plan:Plan}> {
  const request=directAsRequest(input);
  const rows = input.action === 'reverseProduction' ? await reverseProduction(db,input.documentId!) :
    input.action === 'adjustStock' ? await adjustStock(db,input) :
      await createOrPatchOrDelete(db,input);
  invariant(rows.length <= 120, 'Operation exceeds safe direct limit');
  return {request,plan:{schemaVersion:1,requestHash:requestHash(request),projectId:'bem-feito-dev',
    environment:'dev',operation:input.action,scope:rows.map(r=>r.path),rows,dependencies:[]}};
}
