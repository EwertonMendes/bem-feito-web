import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const filePath = resolve(process.argv[2] ?? 'tools/migration/migration-data.json');
const data = JSON.parse(await readFile(filePath, 'utf8'));
if (data.schemaVersion !== 1) throw new Error('Versão da migração inválida.');
const errors = [];
const warnings = [];
const list = (name) => Array.isArray(data[name]) ? data[name] : [];
const index = (name) => new Map(list(name).map((item) => [item.id, item]));

const ensureUnique = (name) => {
  const seen = new Set();
  for (const item of list(name)) {
    if (!item.id) errors.push(`${name}: registro sem id.`);
    if (seen.has(item.id)) errors.push(`${name}: id duplicado ${item.id}.`);
    seen.add(item.id);
  }
};

[
  'collections', 'fragrances', 'formats', 'formatPrices', 'units', 'paymentMethods', 'expenseCategories',
  'expenseTypes', 'inputs', 'products', 'kits', 'additions', 'expenses', 'productions', 'sales', 'payments',
  'stockAdjustments', 'stockMovements', 'counters',
].forEach((name) => {
  if (!Array.isArray(data[name])) errors.push(`${name}: coleção ausente ou inválida.`);
  ensureUnique(name);
});

const collections = index('collections');
const fragrances = index('fragrances');
const formats = index('formats');
const units = index('units');
const inputs = index('inputs');
const products = index('products');
const kits = index('kits');
const additions = index('additions');
const sales = index('sales');

for (const item of list('fragrances')) if (!collections.has(item.collectionId)) errors.push(`fragrances/${item.id}: collectionId inválido.`);
for (const item of list('formatPrices')) {
  if (!collections.has(item.collectionId)) errors.push(`formatPrices/${item.id}: collectionId inválido.`);
  if (!formats.has(item.formatId)) errors.push(`formatPrices/${item.id}: formatId inválido.`);
}
for (const item of list('inputs')) {
  if (!units.has(item.unitId)) errors.push(`inputs/${item.id}: unitId inválido.`);
  if (item.stock < 0) warnings.push(`inputs/${item.id}: estoque negativo ${item.stock}.`);
  if (!item.averageUnitCostCents) warnings.push(`inputs/${item.id}: custo médio ausente.`);
  const expectedStatus = inputStockStatus(item.stock, item.minimumStock, item.minimumStockConfigured !== false);
  if (item.stockStatus !== expectedStatus) errors.push(`inputs/${item.id}: stockStatus divergente.`);
}
for (const item of list('products')) {
  if (!collections.has(item.collectionId)) errors.push(`products/${item.id}: collectionId inválido.`);
  if (item.stockStatus !== productStockStatus(item.stock, item.minimumStock)) errors.push(`products/${item.id}: stockStatus divergente.`);
  if (!fragrances.has(item.fragranceId)) errors.push(`products/${item.id}: fragranceId inválido.`);
  if (!formats.has(item.formatId)) errors.push(`products/${item.id}: formatId inválido.`);
  if (item.stock < 0) warnings.push(`products/${item.id}: estoque negativo ${item.stock}.`);
  if (!item.averageUnitCostCents) warnings.push(`products/${item.id}: custo unitário ausente.`);
  for (const component of item.recipe ?? []) {
    if (!inputs.has(component.inputId)) errors.push(`products/${item.id}: receita referencia insumo inexistente ${component.inputId}.`);
    if (!units.has(component.unitId)) errors.push(`products/${item.id}: receita referencia unidade inexistente ${component.unitId}.`);
  }
}
for (const kit of list('kits')) {
  for (const component of kit.components ?? []) {
    if (!formats.has(component.formatId)) errors.push(`kits/${kit.id}: formato inexistente ${component.formatId}.`);
    if (component.collectionId && !collections.has(component.collectionId)) errors.push(`kits/${kit.id}: coleção inexistente ${component.collectionId}.`);
    if (component.fragranceId && !fragrances.has(component.fragranceId)) errors.push(`kits/${kit.id}: fragrância inexistente ${component.fragranceId}.`);
  }
}
for (const addition of list('additions')) {
  for (const component of addition.components ?? []) {
    if (!inputs.has(component.inputId)) errors.push(`additions/${addition.id}: insumo inexistente ${component.inputId}.`);
    if (!units.has(component.unitId)) errors.push(`additions/${addition.id}: unidade inexistente ${component.unitId}.`);
  }
}
for (const production of list('productions')) if (!products.has(production.productId)) errors.push(`productions/${production.id}: produto inexistente ${production.productId}.`);
for (const payment of list('payments')) if (!sales.has(payment.saleId)) errors.push(`payments/${payment.id}: venda inexistente ${payment.saleId}.`);
for (const sale of list('sales')) {
  const itemTotal = (sale.items ?? []).reduce((sum, item) => sum + Number(item.totalCents ?? 0), 0);
  if (itemTotal !== sale.subtotalCents) warnings.push(`sales/${sale.id}: subtotal armazenado ${sale.subtotalCents} difere dos itens ${itemTotal}.`);
  for (const item of sale.items ?? []) {
    if (item.kind === 'product' && !products.has(item.sourceId)) warnings.push(`sales/${sale.id}: produto histórico ${item.sourceId} não está no catálogo atual.`);
    if (item.kind === 'kit' && !kits.has(item.sourceId)) warnings.push(`sales/${sale.id}: kit histórico ${item.sourceId} não está no catálogo atual.`);
    if (item.kind === 'addition' && !additions.has(item.sourceId)) warnings.push(`sales/${sale.id}: adicional histórico ${item.sourceId} não está no catálogo atual.`);
  }
}
for (const movement of list('stockMovements')) {
  if (movement.itemType === 'product' && !products.has(movement.itemId)) errors.push(`stockMovements/${movement.id}: produto inexistente ${movement.itemId}.`);
  if (movement.itemType === 'input' && !inputs.has(movement.itemId)) errors.push(`stockMovements/${movement.id}: insumo inexistente ${movement.itemId}.`);
}

const dateValid = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const positive = (value) => finite(value) && value > 0 && value <= 1000000;
const idValid = (value) => typeof value === 'string' && value.length > 0 && value.length <= 500 && !value.includes('/');
const paymentMethods = index('paymentMethods');
const productStockStatus = (stock, minimumStock) => stock < 0 ? 'negative' : stock <= minimumStock ? 'low' : 'ok';
const inputStockStatus = (stock, minimumStock, configured) => !configured ? 'untracked' : stock < 0 ? 'negative' : stock <= minimumStock ? 'low' : 'ok';
const expectedSaleAnalytics = (items) => {
  let cogsCents = 0;
  let itemsSold = 0;
  let missingCostItems = 0;
  for (const item of items ?? []) {
    cogsCents += item.totalCostCents;
    if (item.kind === 'product') {
      itemsSold += item.quantity;
      if (item.totalCostCents <= 0) missingCostItems++;
    } else if (item.kind === 'kit') {
      const components = item.components ?? [];
      itemsSold += components.reduce((sum, component) => sum + component.quantity, 0);
      missingCostItems += components.filter((component) => component.unitCostCents <= 0).length;
    }
  }
  return { analyticsVersion: 1, cogsCents, itemsSold, missingCostItems };
};
for (const [name, records] of Object.entries(data)) {
  if (!Array.isArray(records)) continue;
  for (const item of records) {
    if (!idValid(item.id)) errors.push(`${name}: id inválido.`);
    if ('active' in item && typeof item.active !== 'boolean') errors.push(`${name}/${item.id}: active inválido.`);
    for (const [field, value] of Object.entries(item)) {
      if (field.endsWith('Cents') && (!Number.isSafeInteger(value) || value < 0 || value > 1000000000)) errors.push(`${name}/${item.id}: ${field} inválido.`);
    }
    if ('businessDate' in item && !dateValid(item.businessDate)) errors.push(`${name}/${item.id}: data inválida.`);
    if ('stock' in item && (!finite(item.stock) || Math.abs(item.stock) > 1000000)) errors.push(`${name}/${item.id}: estoque inválido.`);
    if ('minimumStock' in item && (!finite(item.minimumStock) || item.minimumStock < 0)) errors.push(`${name}/${item.id}: mínimo inválido.`);
  }
}
for (const product of list('products')) {
  if (fragrances.get(product.fragranceId)?.collectionId !== product.collectionId) errors.push(`products/${product.id}: fragrância de outra coleção.`);
  for (const component of product.recipe ?? []) {
    if (!positive(component.quantity) || inputs.get(component.inputId)?.unitId !== component.unitId) errors.push(`products/${product.id}: consumo/unidade inválido.`);
  }
}
for (const kit of list('kits')) for (const component of kit.components ?? []) {
  if (!Number.isSafeInteger(component.quantity) || component.quantity <= 0 || component.quantity > 1000000) errors.push(`kits/${kit.id}: quantidade inválida.`);
}
for (const addition of list('additions')) for (const component of addition.components ?? []) {
  if (!positive(component.quantity) || inputs.get(component.inputId)?.unitId !== component.unitId) errors.push(`additions/${addition.id}: consumo/unidade inválido.`);
}
for (const production of list('productions')) if (!positive(production.quantity)) errors.push(`productions/${production.id}: quantidade inválida.`);
for (const expense of list('expenses')) {
  if (expense.amountCents <= 0) errors.push(`expenses/${expense.id}: valor inválido.`);
  if (expense.kind === 'input-purchase' && (!inputs.has(expense.inputId) || !positive(expense.quantity) || inputs.get(expense.inputId)?.unitId !== expense.unitId)) errors.push(`expenses/${expense.id}: compra inválida.`);
  if (expense.paymentMethodId && !paymentMethods.has(expense.paymentMethodId)) errors.push(`expenses/${expense.id}: forma de pagamento inválida.`);
}
for (const payment of list('payments')) {
  if (!paymentMethods.has(payment.methodId) || !['active', 'reversed'].includes(payment.status) || payment.amountReceivedCents <= 0) errors.push(`payments/${payment.id}: recebimento inválido.`);
  if (payment.status === 'active' && payment.amountReceivedCents !== payment.appliedCents + payment.tipCents) errors.push(`payments/${payment.id}: alocação divergente.`);
  if (!(sales.get(payment.saleId)?.paymentIds ?? []).includes(payment.id)) errors.push(`payments/${payment.id}: vínculo inverso ausente.`);
}
for (const sale of list('sales')) {
  const linked = list('payments').filter((item) => item.saleId === sale.id && item.status === 'active');
  const analytics = expectedSaleAnalytics(sale.items);
  if (
    sale.analyticsVersion !== analytics.analyticsVersion ||
    sale.cogsCents !== analytics.cogsCents ||
    sale.itemsSold !== analytics.itemsSold ||
    sale.missingCostItems !== analytics.missingCostItems
  ) errors.push(`sales/${sale.id}: analytics divergente.`);
  if (!sale.items?.length || !['active', 'cancelled'].includes(sale.status)) errors.push(`sales/${sale.id}: venda inválida.`);
  if (sale.subtotalCents !== sale.items.reduce((sum, item) => sum + item.totalCents, 0) || sale.totalCents !== sale.subtotalCents - sale.discountCents) errors.push(`sales/${sale.id}: total divergente.`);
  if (sale.status === 'active' && (sale.receivedCents !== linked.reduce((sum, item) => sum + item.appliedCents, 0) || sale.tipCents !== linked.reduce((sum, item) => sum + item.tipCents, 0) || sale.balanceCents !== sale.totalCents - sale.receivedCents)) errors.push(`sales/${sale.id}: recebimentos/saldo divergentes.`);
  for (const paymentId of sale.paymentIds ?? []) if (!index('payments').has(paymentId)) errors.push(`sales/${sale.id}: pagamento inexistente.`);
  for (const item of sale.items ?? []) if (!positive(item.quantity)) errors.push(`sales/${sale.id}: quantidade de item inválida.`);
}
const deltas = new Map();
for (const movement of list('stockMovements')) {
  if (!finite(movement.quantityDelta) || movement.quantityDelta === 0 || Math.abs(movement.quantityDelta) > 1000000) errors.push(`stockMovements/${movement.id}: delta inválido.`);
  const key = `${movement.itemType}:${movement.itemId}`;
  deltas.set(key, (deltas.get(key) ?? 0) + movement.quantityDelta);
}
for (const [name, type] of [['products', 'product'], ['inputs', 'input']]) for (const item of list(name)) {
  if (Math.abs((deltas.get(`${type}:${item.id}`) ?? 0) - item.stock) > 0.000001) errors.push(`${name}/${item.id}: histórico não reconcilia com estoque.`);
}

console.log(`Validação: ${errors.length} erro(s), ${warnings.length} aviso(s).`);
for (const warning of warnings) console.warn(`AVISO: ${warning}`);
for (const error of errors) console.error(`ERRO: ${error}`);
if (errors.length) process.exitCode = 1;
