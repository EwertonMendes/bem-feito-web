import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const filePath = resolve(process.argv[2] ?? 'tools/migration/migration-data.json');
const data = JSON.parse(await readFile(filePath, 'utf8'));
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
].forEach(ensureUnique);

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
}
for (const item of list('products')) {
  if (!collections.has(item.collectionId)) errors.push(`products/${item.id}: collectionId inválido.`);
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

console.log(`Validação: ${errors.length} erro(s), ${warnings.length} aviso(s).`);
for (const warning of warnings) console.warn(`AVISO: ${warning}`);
for (const error of errors) console.error(`ERRO: ${error}`);
if (errors.length) process.exitCode = 1;
