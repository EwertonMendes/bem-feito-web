import { type Firestore } from 'firebase-admin/firestore';
import { encode } from './codec.ts';
import { hash, invariant, identifier, requestHash } from './schema.ts';
import type { Request, Payload } from './schema.ts';
import { snapshotRow, type Plan, type Row } from './engine.ts';

type Value = string | number | boolean | null | Value[] | { [key: string]: Value };
type DirectAction = 'create' | 'patch' | 'delete' | 'reverseProduction' | 'adjustStock' | 'deliverSale' | 'recordPaidSale' | 'correctPaidSalePrice';
export type DirectRequest = {
  schemaVersion: 1; id: string; environment: 'dev'; projectId: 'bem-feito-dev';
  action: DirectAction;
  collection?: string; documentId?: string;
  expected?: Record<string, Value>; expectedAbsent?: string[]; values?: Record<string, Value>;
  itemType?: 'product' | 'input'; itemId?: string; quantityDelta?: number;
  reason?: string; businessDate?: string;
  /** Public sale code only, not a customer identifier. */
  saleCode?: string;
  /** A single stock-backed paid/fulfilled sale; no direct ledger write input. */
  paymentCode?: string; lineItemId?: string; productId?: string; paymentMethodId?: string;
  quantity?: number; unitPriceCents?: number; expectedAvailableStock?: number;
  customerName?: string;
  /** Original amount required as a compare-and-swap guard for a financial correction. */
  expectedOriginalTotalCents?: number;
};

// Field names and collection names are not business allowlists. Only infrastructure
// collections are excluded: editing them would bypass authentication/audit itself.
const RESERVED_COLLECTIONS = new Set(['system','dataAdminOperations','migrationRuns','migrationSources','counters','kits']);
const DELETABLE = new Set(['dataAdminSmoke','expenseCategories']);
const MAX_PAYLOAD = 10000;
const props = (v: unknown, keys: string[]) => {
  invariant(!!v && typeof v === 'object' && !Array.isArray(v), 'Expected object');
  invariant(Object.keys(v).every(k => keys.includes(k) && !['__proto__','prototype','constructor'].includes(k)), 'Unexpected request property');
  return v as Record<string, unknown>;
};
const key = (name: string) => {
  invariant(name.length > 0 && name.length <= 150 &&
    !/[\x00-\x1f/]/.test(name) && !/^__.*__$/.test(name) &&
    !['__proto__','prototype','constructor'].includes(name), 'Invalid field key');
};
const validateValue = (value: unknown, depth = 0): void => {
  invariant(depth <= 10, 'Value nested too deeply');
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'string') {
    invariant(value.length <= 8000 && !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value), 'Invalid text value');
    return;
  }
  if (typeof value === 'number') {
    invariant(Number.isFinite(value) && Math.abs(value) <= 1e12, 'Invalid numeric value');
    return;
  }
  if (Array.isArray(value)) {
    invariant(value.length <= 250, 'Array too long');
    for (const item of value) validateValue(item, depth + 1);
    return;
  }
  invariant(value !== null && typeof value === 'object', 'Unsupported value');
  const entries = Object.entries(value);
  invariant(entries.length <= 250, 'Map too large');
  for (const [name, item] of entries) { key(name); validateValue(item, depth + 1); }
};
const fieldValues = (value: unknown, allowEmpty = false) => {
  invariant(!!value && typeof value === 'object' && !Array.isArray(value), 'Expected fields object');
  const entries = Object.entries(value);
  invariant(allowEmpty || entries.length > 0, 'No fields to change');
  invariant(entries.length <= 100, 'Too many fields');
  for (const [name, item] of entries) { key(name); validateValue(item); }
  return value as Record<string, Value>;
};
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function validateDirectRequest(input: string): DirectRequest {
  invariant(typeof input === 'string' && input.length > 0 && input.length <= MAX_PAYLOAD, 'Invalid direct request size');
  let raw: unknown;
  try { raw = JSON.parse(input); } catch { throw Error('Invalid direct request JSON'); }
  const o = props(raw, ['schemaVersion','id','environment','projectId','action','collection','documentId',
    'expected','expectedAbsent','values','itemType','itemId','quantityDelta','reason','businessDate','saleCode',
    'paymentCode','lineItemId','productId','paymentMethodId','quantity','unitPriceCents','expectedAvailableStock','customerName','expectedOriginalTotalCents']);
  invariant(o.schemaVersion === 1 && o.environment === 'dev' && o.projectId === 'bem-feito-dev',
    'Direct administration is DEV-only');
  identifier(o.id);
  invariant((o.id as string).length <= 80, 'Operation ID too long');
  invariant(['create','patch','delete','reverseProduction','adjustStock','deliverSale','recordPaidSale','correctPaidSalePrice'].includes(String(o.action)), 'Unknown direct action');
  const action = o.action;
  if (action !== 'recordPaidSale' && action !== 'correctPaidSalePrice') invariant(
    ['paymentCode','lineItemId','productId','paymentMethodId','quantity','unitPriceCents',
      'expectedAvailableStock','customerName','expectedOriginalTotalCents'].every(k => o[k] === undefined),
    'Paid sale fields cannot be used in other actions');
  if (['create','patch','delete'].includes(String(action))) {
    identifier(o.collection);
    invariant(!RESERVED_COLLECTIONS.has(o.collection), 'Protected infrastructure collection');
    identifier(o.documentId);
    if (o.collection === 'dataAdminSmoke') invariant(String(o.documentId).startsWith('smoke-'), 'Protected test namespace');
    invariant(['itemType','itemId','quantityDelta','reason','businessDate','saleCode'].every(k => o[k] === undefined), 'Unexpected stock parameters');
    if (action === 'create') {
      invariant(o.expected === undefined && o.expectedAbsent === undefined, 'Create cannot provide preconditions');
      fieldValues(o.values);
    } else if (action === 'patch') {
      const values = fieldValues(o.values);
      const expected = fieldValues(o.expected, true);
      invariant(o.expectedAbsent === undefined || Array.isArray(o.expectedAbsent), 'Invalid missing-field preconditions');
      const missing = (o.expectedAbsent ?? []) as unknown[];
      invariant(missing.length <= 100 && missing.every(v => typeof v === 'string'), 'Invalid missing-field names');
      for (const name of missing as string[]) key(name);
      const keys = [...Object.keys(expected), ...missing as string[]];
      invariant(keys.length === new Set(keys).size && keys.length === Object.keys(values).length &&
        keys.every(k => Object.hasOwn(values,k)), 'Patch requires one precondition per changed field');
    } else {
      invariant(DELETABLE.has(o.collection as string), 'Business deletion requires domain-aware action');
      invariant(o.expected === undefined && o.expectedAbsent === undefined && o.values === undefined, 'Delete takes no data fields');
    }
  } else if (action === 'reverseProduction') {
    invariant(o.collection === undefined && o.expected === undefined && o.expectedAbsent === undefined && o.values === undefined &&
      o.itemType === undefined && o.itemId === undefined && o.quantityDelta === undefined &&
      o.reason === undefined && o.businessDate === undefined && o.saleCode === undefined, 'Unexpected reversal parameters');
    identifier(o.documentId);
  } else if (action === 'recordPaidSale') {
    invariant(['collection','documentId','expected','expectedAbsent','values','itemType',
      'itemId','quantityDelta','reason','expectedOriginalTotalCents'].every(k=>o[k]===undefined),
      'Paid sale accepts only validated order parameters');
    invariant(typeof o.saleCode === 'string' && /^V[0-9]{5}$/.test(o.saleCode), 'Sale code required');
    invariant(typeof o.paymentCode === 'string' && /^P[0-9]{6}$/.test(o.paymentCode), 'Payment code required');
    invariant(typeof o.lineItemId === 'string' && /^I[0-9]{6}$/.test(o.lineItemId), 'Sale item code required');
    identifier(o.productId); identifier(o.paymentMethodId);
    invariant(typeof o.customerName === 'string' && /^[\p{L} .'-]{2,80}$/u.test(o.customerName.trim()),
      'Customer name required');
    invariant(typeof o.businessDate === 'string' && DAY.test(o.businessDate) &&
      !Number.isNaN(Date.parse(o.businessDate)), 'Valid business date required');
    invariant(Number.isSafeInteger(o.quantity) && Number(o.quantity) >= 1 && Number(o.quantity) <= 200,
      'Positive integer quantity required');
    invariant(Number.isSafeInteger(o.unitPriceCents) && Number(o.unitPriceCents) >= 0 && Number(o.unitPriceCents) <= 1_000_000,
      'Price in integer cents required');
    invariant(Number.isSafeInteger(o.expectedAvailableStock) && Number(o.expectedAvailableStock) >= Number(o.quantity),
      'Expected available stock must cover the sale');

  } else if (action === 'correctPaidSalePrice') {
    invariant(['collection','documentId','expected','expectedAbsent','values','itemType',
      'itemId','quantityDelta','reason','lineItemId','quantity','expectedAvailableStock']
      .every(k=>o[k]===undefined),
      'Correction accepts only validated sale and payment identifiers');
    invariant(typeof o.saleCode === 'string' && /^V[0-9]{5}$/.test(o.saleCode),
      'Sale code required');
    invariant(typeof o.paymentCode === 'string' && /^P[0-9]{6}$/.test(o.paymentCode),
      'Payment code required');
    identifier(o.productId); identifier(o.paymentMethodId);
    invariant(typeof o.customerName === 'string' && /^[\p{L} .'-]{2,80}$/u.test(o.customerName.trim()),
      'Customer name required');
    invariant(typeof o.businessDate === 'string' && DAY.test(o.businessDate) &&
      !Number.isNaN(Date.parse(o.businessDate)), 'Business date required');
    invariant(Number.isSafeInteger(o.unitPriceCents) && Number(o.unitPriceCents) >= 0 &&
      Number(o.unitPriceCents) <= 1_000_000, 'Valid catalog price required');
    invariant(Number.isSafeInteger(o.expectedOriginalTotalCents) &&
      Number(o.expectedOriginalTotalCents) >= 0 &&
      Number(o.expectedOriginalTotalCents) <= 1_000_000 &&
      o.expectedOriginalTotalCents !== o.unitPriceCents,
      'Explicit original amount and a different catalog price required');
  } else if (action === 'deliverSale') {
    invariant(['collection','documentId','expected','expectedAbsent','values','itemType',
      'itemId','quantityDelta','reason','businessDate'].every(k => o[k] === undefined),
      'Delivery cannot contain raw writes or payment changes');
    invariant(typeof o.saleCode === 'string' && /^V[0-9]{5}$/.test(o.saleCode),
      'Exact sale code required');
  } else {
    invariant(o.saleCode === undefined, 'Stock adjustment cannot specify a sale');
    invariant(o.collection === undefined && o.documentId === undefined && o.expected === undefined &&
      o.expectedAbsent === undefined && o.values === undefined, 'Stock adjustment does not accept raw field writes');
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
      for (const [name,value] of Object.entries(input.expected!)) {
        invariant(Object.hasOwn(before,name), 'Expected field missing');
        invariant(hash(encode(before[name])) === hash(encode(value)), 'Field precondition differs');
      }
      for (const name of input.expectedAbsent ?? []) invariant(!Object.hasOwn(before,name), 'Expected field to be absent');
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

/**
 * Audited DEV delivery, equivalent to SalesRepository.advanceFulfillment(..., 'delivered').
 * A pure status patch would leave committed/reserved quantities and stock movements
 * inconsistent. This planner includes every dependent document in the atomic plan.
 */
async function deliverSale(db: Firestore, saleCode: string): Promise<Row[]> {
  const result = await db.collection('sales').where('code','==',saleCode).limit(2).get();
  invariant(result.size === 1, 'Expected exactly one sale with the supplied code');
  const saleSnap = result.docs[0]!;
  const before = saleSnap.data();
  invariant(before.status === 'active' && before.stockApplied === false &&
    before.fulfillmentStatus === 'ready', 'Only ready and unfulfilled active sales may be delivered');
  const effects = before.stockEffects;
  invariant(Array.isArray(effects) && effects.length > 0 && effects.length <= 60,
    'Delivery requires a bounded, known stock effect ledger');
  const aggregates = new Map<string, {type:'product'|'input'; itemId:string; required:number}>();
  for (const effect of effects) {
    invariant(effect && ['product','input'].includes(effect.itemType), 'Unknown stock effect type');
    identifier(effect.itemId);
    invariant(typeof effect.quantityDelta === 'number' && Number.isFinite(effect.quantityDelta) &&
      effect.quantityDelta < 0 && Math.abs(effect.quantityDelta) <= 1_000_000,
      'Invalid delivery stock quantity');
    invariant(effect.itemType !== 'product' || Number.isSafeInteger(effect.quantityDelta),
      'Product quantity must be an integer');
    invariant(Number.isSafeInteger(effect.unitCostCents) && effect.unitCostCents >= 0,
      'Invalid unit cost in stock effect');
    const path = (effect.itemType === 'product' ? 'products/' : 'inputs/') + effect.itemId;
    const old = aggregates.get(path);
    aggregates.set(path,{type:effect.itemType,itemId:effect.itemId,
      required:(old?.required ?? 0)-effect.quantityDelta});
  }
  // An order marked ready with explicit allocations must have allocated every item.
  if (before.orderAllocations !== undefined) {
    invariant(Array.isArray(before.orderAllocations) && Array.isArray(before.items),
      'Malformed individual order allocation ledger');
    for (const line of before.items.filter((x:any)=>x.kind === 'product')) {
      const allocated = before.orderAllocations
        .filter((x:any)=>x.lineId === line.id && x.productId === line.sourceId)
        .reduce((sum:number,x:any)=>sum+Number(x.quantity),0);
      invariant(Number.isSafeInteger(line.quantity) && allocated === line.quantity,
        'Delivery requires complete physical allocation for each product line');
    }
  }
  const paths = [...aggregates.keys()];
  const snapshots = await db.getAll(...paths.map(p=>db.doc(p)));
  const rows:Row[] = [snapshotRow(saleSnap)];
  snapshotData(rows[0]!,{...before,fulfillmentStatus:'delivered',stockApplied:true});
  for (let i=0;i<paths.length;i++) {
    const snapshot = snapshots[i]!;
    const req = aggregates.get(paths[i]!)!;
    invariant(snapshot.exists, 'Delivery stock item missing');
    const data = snapshot.data()!;
    const stock = Number(data.stock), committed = Number(data.committedStock ?? 0);
    const physicalReserved = Number(data.reservedPhysicalStock ?? Math.min(stock,committed));
    invariant(Number.isFinite(stock) && Number.isFinite(committed) &&
      Number.isFinite(physicalReserved) && stock >= req.required &&
      committed >= req.required && physicalReserved >= req.required &&
      physicalReserved <= stock && physicalReserved <= committed,
      'Physical inventory or delivery reservation inconsistent');
    const afterStock = stock-req.required;
    const afterCommitted = committed-req.required;
    const afterReserved = physicalReserved-req.required;
    const tracked = before.orderAllocations !== undefined && req.type === 'product';
    const explicit:Record<string,number> = tracked ? {
      explicitCommittedStock:Number(data.explicitCommittedStock)-req.required,
      explicitAllocatedStock:Number(data.explicitAllocatedStock)-req.required,
    } : {};
    if (tracked) invariant(
      Number.isSafeInteger(explicit.explicitCommittedStock!) &&
      Number.isSafeInteger(explicit.explicitAllocatedStock!) &&
      explicit.explicitCommittedStock! >= 0 && explicit.explicitAllocatedStock! >= 0 &&
      explicit.explicitAllocatedStock! <= explicit.explicitCommittedStock!,
      'Tracked order reservation counters inconsistent');
    const row=snapshotRow(snapshot);
    snapshotData(row,{...data,stock:afterStock,committedStock:afterCommitted,
      reservedPhysicalStock:afterReserved,...explicit,
      stockStatus:req.type === 'product'
        ? statusProduct(afterStock,Number(data.minimumStock ?? 0))
        : statusInput(data,afterStock)});
    rows.push(row);
  }
  // The app posts movements using the date of accounting/posting, not a guessed
  // historical delivery date. No payment record is created or changed.
  const businessDate = new Date().toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'});
  invariant(DAY.test(businessDate), 'Cannot resolve local posting date');
  for (let i=0;i<effects.length;i++) {
    const effect=effects[i];
    const movementRef=db.doc('stockMovements/admin-delivery-'+saleCode+'-'+String(i+1).padStart(2,'0'));
    const old=await movementRef.get();
    invariant(!old.exists, 'Delivery stock movement already exists');
    const row=snapshotRow(old);
    snapshotData(row,{
      itemType:effect.itemType,itemId:effect.itemId,quantityDelta:effect.quantityDelta,
      unitCostCents:effect.unitCostCents,
      totalCostCents:Math.round(-effect.quantityDelta *
        (effect.unitCostDeciCents ?? effect.unitCostCents*10)/10),
      sourceType:'sale',sourceId:saleSnap.id,businessDate,
    });
    rows.push(row);
  }
  return rows;
}


/** Register one fully paid, immediately fulfilled product sale without partial updates.
 * All writes (sale, Pix, inventory movement, product balance, sequential counters)
 * use the same audited transaction and its independent pre-commit backup.
 */
async function recordPaidSale(db: Firestore, input: DirectRequest): Promise<Row[]> {
  const saleCode=input.saleCode!, paymentCode=input.paymentCode!;
  const saleSeq=Number(saleCode.slice(1)), paymentSeq=Number(paymentCode.slice(1));
  const [saleCounter,paymentCounter,product,method,sale,payment,movement]=await db.getAll(
    db.doc('counters/sale'),db.doc('counters/payment'),
    db.doc('products/'+input.productId!),db.doc('paymentMethods/'+input.paymentMethodId!),
    db.doc('sales/'+saleCode),db.doc('payments/'+paymentCode),
    db.doc('stockMovements/admin-sale-'+saleCode));
  invariant(saleCounter.exists && paymentCounter.exists, 'Sale/payment counters missing');
  invariant(Number(saleCounter.data()?.value) + 1 === saleSeq &&
    Number(paymentCounter.data()?.value) + 1 === paymentSeq,
    'Spreadsheet codes disagree with DEV counters; reconcile before posting');
  invariant(product.exists && product.data()?.active === true, 'Product missing or inactive');
  const p=product.data()!;
  invariant(p.salePriceCents === input.unitPriceCents,
    'Sale price differs from active catalog product');
  const methodName=String(method.data()?.name??'').trim();
  invariant(method.exists && method.data()?.active === true &&
    ['pix','dinheiro'].includes(methodName.toLocaleLowerCase('pt-BR')),
    'Payment method must be active Pix or Dinheiro');
  invariant(!sale.exists && !payment.exists && !movement.exists, 'Duplicate sale, payment or inventory entry');
  const matching=await db.collection('sales').where('code','==',saleCode).limit(1).get();
  invariant(matching.empty, 'Duplicate sale code already registered');
  const matchingPayment=await db.collection('payments').where('code','==',paymentCode).limit(1).get();
  invariant(matchingPayment.empty, 'Duplicate payment code already registered');
  const stock=Number(p.stock), committed=Number(p.committedStock??0);
  const physical=Number(p.reservedPhysicalStock??Math.min(stock,committed));
  const available=stock-physical;
  const qty=input.quantity!;
  invariant(Number.isSafeInteger(stock) && Number.isSafeInteger(committed) &&
    Number.isSafeInteger(physical) && stock>=0 && committed>=0 &&
    physical>=0 && physical<=stock && physical<=committed &&
    available===input.expectedAvailableStock && available>=qty,
    'Physical inventory or reserved quantities changed; reconcile before sale');
  const total=qty*input.unitPriceCents!;
  invariant(Number.isSafeInteger(total) && total<=1_000_000_000, 'Invalid sale total');
  const cost=Number(p.averageUnitCostCents??p.additionalCostCents??0);
  invariant(Number.isSafeInteger(cost) && cost>=0 && cost<=1_000_000,
    'Unit cost must be a nonnegative integer');
  const costDeci=p.unitCostDeciCents;
  invariant(costDeci===undefined || Number.isSafeInteger(costDeci), 'Invalid stored fractional cost');
  const costTotal=Math.round(qty * (costDeci===undefined?cost*10:costDeci)/10);
  const effect={itemType:'product',itemId:input.productId!,quantityDelta:-qty,
    unitCostCents:cost,...(costDeci===undefined?{}:{unitCostDeciCents:costDeci})};
  const line={id:input.lineItemId!,
    kind:'product',sourceId:input.productId!,name:String(p.displayName),
    ...(p.image?{image:p.image}:{}),
    quantity:qty,unitPriceCents:input.unitPriceCents!,unitCostCents:cost,
    totalCents:total,totalCostCents:costTotal,categoryId:p.categoryId??'soap',
    ...(p.categoryId===undefined || p.categoryId==='soap'?
      {collectionId:p.collectionId,fragranceId:p.fragranceId,formatId:p.formatId}:{}),
    stockEffects:[effect]};
  invariant(typeof p.displayName==='string' && p.displayName.length>0,'Product name missing');
  const name=input.customerName!.trim();
  const normalized=name.normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .toLocaleLowerCase('pt-BR').replace(/\s+/g,' ').trim();
  const prefixes=new Set<string>();
  for(const word of [normalized,...normalized.split(' ')].filter(Boolean))
    for(let i=2;i<=Math.min(word.length,60);i++) prefixes.add(word.slice(0,i));
  const order={code:saleCode,businessDate:input.businessDate!,customerName:name,
    customerSearchKey:normalized,customerSearchPrefixes:[...prefixes],
    productIds:[input.productId!],discountCents:0,subtotalCents:total,totalCents:total,
    receivedCents:total,tipCents:0,balanceCents:0,paymentStatus:'paid',status:'active',
    fulfillmentStatus:'delivered',stockApplied:true,
    notes:`Venda presencial quitada por ${methodName}, entregue no mesmo dia.`,
    items:[line],
    paymentIds:[paymentCode],stockEffects:[effect],
    analyticsVersion:1,cogsCents:costTotal,itemsSold:qty,missingCostItems:costTotal<=0?1:0};
  const receipt={code:paymentCode,saleId:saleCode,businessDate:input.businessDate!,
    methodId:input.paymentMethodId!,amountReceivedCents:total,appliedCents:total,
    tipCents:0,status:'active'};
  const rows=[snapshotRow(saleCounter),snapshotRow(paymentCounter),snapshotRow(product),
    snapshotRow(sale),snapshotRow(payment),snapshotRow(movement)];
  snapshotData(rows[0]!,{...saleCounter.data(),value:saleSeq});
  snapshotData(rows[1]!,{...paymentCounter.data(),value:paymentSeq});
  snapshotData(rows[2]!,{...p,stock:stock-qty,
    stockStatus:statusProduct(stock-qty,Number(p.minimumStock??0))});
  snapshotData(rows[3]!,order);
  snapshotData(rows[4]!,receipt);
  snapshotData(rows[5]!,{...effect,totalCostCents:costTotal,sourceType:'sale',
    sourceId:saleCode,businessDate:input.businessDate!});
  return rows;
}

/** Corrects only the financial value of a single delivered, fully-paid sale.
 * Stock, cost, reservations, counters and existing movements are intentionally immutable.
 * The archived plan and atomic readback provide auditability and safe retries.
 */
async function correctPaidSalePrice(db: Firestore, input: DirectRequest): Promise<Row[]> {
  const code=input.saleCode!, paymentCode=input.paymentCode!;
  const [sale,receipt,product,method,movement]=await db.getAll(
    db.doc('sales/'+code),
    db.doc('payments/'+paymentCode),
    db.doc('products/'+input.productId!),
    db.doc('paymentMethods/'+input.paymentMethodId!),
    db.doc('stockMovements/admin-sale-'+code));
  invariant(sale.exists && receipt.exists && product.exists && method.exists && movement.exists,
    'Sale, payment, catalog or inventory audit record missing');
  const v=sale.data()!, r=receipt.data()!, p=product.data()!, m=method.data()!, mv=movement.data()!;
  const before=input.expectedOriginalTotalCents!, after=input.unitPriceCents!;
  invariant(v.code===code && v.customerName===input.customerName!.trim() &&
    v.businessDate===input.businessDate && v.status==='active' &&
    v.fulfillmentStatus==='delivered' && v.stockApplied===true &&
    v.paymentStatus==='paid' && v.balanceCents===0 &&
    v.discountCents===0 && v.tipCents===0 && v.itemsSold===1 &&
    v.subtotalCents===before && v.totalCents===before &&
    v.receivedCents===before &&
    Array.isArray(v.paymentIds) && v.paymentIds.length===1 &&
    v.paymentIds[0]===paymentCode, 'Sale state differs from expected single paid sale');
  invariant(Array.isArray(v.items) && v.items.length===1 &&
    v.items[0].kind==='product' && v.items[0].sourceId===input.productId &&
    v.items[0].quantity===1 && v.items[0].unitPriceCents===before &&
    v.items[0].totalCents===before &&
    Array.isArray(v.items[0].stockEffects) &&
    v.items[0].stockEffects.length===1 &&
    v.items[0].stockEffects[0].itemType==='product' &&
    v.items[0].stockEffects[0].itemId===input.productId &&
    v.items[0].stockEffects[0].quantityDelta===-1 &&
    Array.isArray(v.stockEffects) && v.stockEffects.length===1,
    'Line item or inventory history differs');
  invariant(r.code===paymentCode && r.saleId===code &&
    r.businessDate===input.businessDate &&
    r.methodId===input.paymentMethodId && r.status==='active' &&
    r.tipCents===0 && r.amountReceivedCents===before &&
    r.appliedCents===before, 'Payment state differs from expected amount');
  invariant(p.active===true && p.salePriceCents===after,
    'Corrected price must exactly match the active catalog');
  invariant(m.active===true && String(m.name).trim().toLocaleLowerCase('pt-BR')==='dinheiro',
    'Expected cash payment method missing');
  invariant(mv.sourceType==='sale' && mv.sourceId===code &&
    mv.itemType==='product' && mv.itemId===input.productId &&
    mv.quantityDelta===-1, 'Original stock movement differs');
  const rows=[snapshotRow(sale),snapshotRow(receipt)];
  const oldLabel=(before/100).toFixed(2), newLabel=(after/100).toFixed(2);
  snapshotData(rows[0]!,{...v,
    subtotalCents:after,totalCents:after,receivedCents:after,
    items:[{...v.items[0],unitPriceCents:after,totalCents:after}],
    notes:`Venda presencial quitada em dinheiro e entregue no mesmo dia. Valor corrigido de R$ ${oldLabel} para R$ ${newLabel} conforme preço de catálogo, após erro de lançamento. Estoque e custo preservados.`});
  snapshotData(rows[1]!,{...r,amountReceivedCents:after,appliedCents:after});
  return rows;
}

export async function prepareDirect(input: DirectRequest, db: Firestore): Promise<{request:Request;plan:Plan}> {
  const request=directAsRequest(input);
  const rows = input.action === 'reverseProduction' ? await reverseProduction(db,input.documentId!) :
    input.action === 'adjustStock' ? await adjustStock(db,input) :
      input.action === 'deliverSale' ? await deliverSale(db,input.saleCode!) :
        input.action === 'recordPaidSale' ? await recordPaidSale(db,input) :
          input.action === 'correctPaidSalePrice' ? await correctPaidSalePrice(db,input) :
            await createOrPatchOrDelete(db,input);
  invariant(rows.length <= 120, 'Operation exceeds safe direct limit');
  return {request,plan:{schemaVersion:1,requestHash:requestHash(request),projectId:'bem-feito-dev',
    environment:'dev',operation:input.action,scope:rows.map(r=>r.path),rows,dependencies:[]}};
}
