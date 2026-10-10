import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/**
 * Deterministic business-state reconciliation of an exported snapshot.
 * No synthetic stock adjustments: pending receipts and unfulfilled sales
 * must not be posted as physical movements.
 */
const rawPath = resolve(process.argv[2] ?? 'tools/migration/legacy-raw.json');
const dataPath = resolve(process.argv[3] ?? 'tools/migration/migration-data.json');
const raw = JSON.parse(await readFile(rawPath, 'utf8'));
const data = JSON.parse(await readFile(dataPath, 'utf8'));
const text = value => String(value ?? '').trim();
const integer = value => Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : null;
const cents = value => Math.round(Number(value) * 100);
const productMap = new Map(data.products.map(item => [item.id, item]));
const inputMap = new Map(data.inputs.map(item => [item.id, item]));
const saleMap = new Map(data.sales.map(item => [item.id, item]));
const expenseMap = new Map(data.expenses.map(item => [item.id, item]));
const legacyRows = name => raw.sheets?.[name] ?? [];
const auditRows = name => raw.views?.[name] ?? [];
const status = (stock, min) => stock <= min ? 'low' : 'ok';

for (const row of legacyRows('Compras e Despesas')) {
  const expense = expenseMap.get(text(row.Mov_ID));
  if (!expense) continue;
  const source = text(row['Origem do pagamento']).toLocaleLowerCase('pt-BR');
  expense.fundingSource = source.includes('maria') ? 'maria' :
    source.includes('bem feito') ? 'business' :
    source.includes('pessoal') ? 'ewerton' : 'unverified';
  expense.bankDebitCents = expense.fundingSource === 'business' ? expense.amountCents : 0;
  if (expense.kind !== 'input-purchase') continue;
  const receipt = text(row.Recebimento).toLocaleLowerCase('pt-BR');
  expense.receiptStatus = receipt.includes('aguardando') ? 'pending' : 'received';
  expense.stockApplied = expense.receiptStatus === 'received' && Boolean(expense.inputId);
  if (!expense.inputId) {
    expense.legacyUnallocatedPurchase = true;
    const goods = text(row.Insumo);
    expense.notes = [expense.notes, 'Compra histórica não alocada ao estoque por ausência de Insumo_ID: ' + goods]
      .filter(Boolean).join(' | ');
  }
}
const openSaleIds = new Set();
for (const row of legacyRows('Vendas')) {
  const sale = saleMap.get(text(row.Venda_ID));
  if (!sale || sale.status !== 'active') continue;
  const fulfillment = text(row['Andamento da Encomenda']).toLocaleLowerCase('pt-BR');
  if (fulfillment.includes('produção')) sale.fulfillmentStatus = 'in-production';
  else if (fulfillment.includes('pronto')) sale.fulfillmentStatus = 'ready';
  else sale.fulfillmentStatus = 'delivered';
  sale.stockApplied = sale.fulfillmentStatus === 'delivered';
  if (!sale.stockApplied) openSaleIds.add(sale.id);
}
const organza = data.additions.find(item => text(item.name).toLocaleLowerCase('pt-BR').includes('organza'));
for (const sale of data.sales) {
  for (const item of sale.items ?? []) {
    if (item.kind === 'addition' && !item.sourceId && organza &&
      text(item.name).toLocaleLowerCase('pt-BR').includes('organza')) item.sourceId = organza.id;
  }
}
const packagingReservations = new Map();
for (const row of auditRows('Reservas de Embalagem')) {
  const saleId = text(row.Venda_ID);
  const inputId = text(row.Insumo_ID);
  if (!saleId || !inputId) continue;
  const sale = saleMap.get(saleId), input = inputMap.get(inputId);
  const quantity = integer(row['Reserva atual']);
  if (quantity === null || quantity > 1000000) throw new Error('Quantidade de embalagem reservada inválida.');
  if (!sale || !input) throw new Error('Reserva de embalagem com vínculo inexistente.');
  // Keep released historical reservations in the audit, but never reactivate them.
  if (quantity === 0) continue;
  if (!openSaleIds.has(saleId)) throw new Error('Reserva de embalagem não vinculada a encomenda ativa.');
  const current = sale.stockEffects.find(item => item.itemType === 'input' && item.itemId === inputId);
  if (current && current.quantityDelta !== -quantity) throw new Error('Reserva de embalagem diverge dos efeitos originais.');
  if (!current) sale.stockEffects.push({
    itemType: 'input', itemId: inputId, quantityDelta: -quantity,
    unitCostCents: input.averageUnitCostCents,
  });
  packagingReservations.set(inputId, (packagingReservations.get(inputId) ?? 0) + quantity);
  if (!sale.items.some(item => item.kind === 'addition' && item.sourceId === organza?.id)) {
    const cost = Math.round(input.averageUnitCostCents * quantity);
    sale.items.push({
      id: 'migration-packaging-' + sale.id + '-' + inputId,
      kind: 'addition', sourceId: organza?.id ?? '',
      name: 'Embalagem de organza inclusa', quantity, unitPriceCents: 0,
      unitCostCents: input.averageUnitCostCents,
      totalCents: 0, totalCostCents: cost,
    });
  }
}
const counted = new Map();
for (const row of auditRows('Inventário 08-10')) {
  const id = text(row.Produto_ID);
  if (!id) continue;
  if (!productMap.has(id)) throw new Error('Inventário contém produto não cadastrado: ' + id);
  const qty = integer(row['Unidades físicas']);
  if (qty === null) throw new Error('Inventário físico contém quantidade não inteira.');
  const destination = text(row.Destinação).toLocaleLowerCase('pt-BR');
  if (!destination.includes('reservado') && !destination.includes('livre')) throw new Error('Destinação desconhecida no inventário.');
  const item = counted.get(id) ?? { physical: 0, reserved: 0 };
  item.physical += qty;
  if (destination.includes('reservado')) item.reserved += qty;
  counted.set(id, item);
}
// The inventory audit is dated and may include reservations already delivered.
 // Current Products physical stock is authoritative when explicitly available.
const currentPhysical = new Set();
for (const row of legacyRows('Produtos')) {
  const id = text(row.Produto_ID);
  const product = productMap.get(id);
  if (!product || row['Estoque Físico'] === '' ||
    row['Estoque Físico'] === null || row['Estoque Físico'] === undefined) continue;
  const physical = integer(row['Estoque Físico']);
  if (physical === null) throw new Error('Estoque físico atual inválido: ' + id);
  product.stock = physical;
  product.stockStatus = status(physical, product.minimumStock);
  currentPhysical.add(id);
}
for (const [id, audit] of counted) {
  if (currentPhysical.has(id)) continue;
  const product = productMap.get(id);
  product.stock = audit.physical;
  product.stockStatus = status(audit.physical, product.minimumStock);
}
for (const item of [...data.products, ...data.inputs]) {
  item.committedStock = 0;
  item.reservedPhysicalStock = 0;
}
for (const sale of data.sales) {
  if (!openSaleIds.has(sale.id)) continue;
  for (const effect of sale.stockEffects) {
    const target = effect.itemType === 'product' ? productMap.get(effect.itemId) : inputMap.get(effect.itemId);
    if (!target || effect.quantityDelta >= 0) throw new Error('Encomenda sem item cadastrado ou efeito inválido.');
    target.committedStock += -effect.quantityDelta;
    if (effect.itemType === 'product' && sale.fulfillmentStatus === 'ready') target.reservedPhysicalStock += -effect.quantityDelta;
  }
}
for (const [id, count] of counted) {
  // Do not resurrect reservations from older inventory when current stock is known.
  if (!currentPhysical.has(id)) productMap.get(id).reservedPhysicalStock += count.reserved;
}
for (const [id, qty] of packagingReservations) inputMap.get(id).reservedPhysicalStock += qty;
for (const entity of [...data.products, ...data.inputs]) {
  if (entity.reservedPhysicalStock > entity.stock || entity.reservedPhysicalStock > entity.committedStock)
    throw new Error('Reserva física excede estoque ou compromisso: ' + entity.id);
}
data.stockMovements = data.stockMovements.filter(move => {
  if (move.sourceType === 'sale' && openSaleIds.has(move.sourceId)) return false;
  if (move.sourceType === 'purchase' && expenseMap.get(move.sourceId)?.receiptStatus === 'pending') return false;
  return true;
});
for (const sale of data.sales) {
  if (!openSaleIds.has(sale.id)) continue;
  sale.cogsCents = sale.items.reduce((sum, item) => sum + item.totalCostCents, 0);
  sale.itemsSold = sale.items.reduce((sum, item) => sum + (item.kind === 'product' ? item.quantity :
    item.kind === 'kit' ? (item.components ?? []).reduce((s, part) => s + part.quantity, 0) : 0), 0);
  sale.missingCostItems = sale.items.reduce((sum, item) =>
    sum + (item.kind === 'product' && item.totalCostCents <= 0 ? 1 : 0) +
    (item.kind === 'kit' ? (item.components ?? []).filter(part => part.unitCostCents <= 0).length : 0), 0);
}
const bank = raw.sourceMetadata?.bankSnapshot;
if (!bank || !Number.isSafeInteger(bank.balanceCents) || !Number.isSafeInteger(bank.ownerFundedCents) ||
  !/^\d{4}-\d{2}-\d{2}$/.test(bank.businessDate)) throw new Error('Snapshot bancário assinado ausente.');
data.bankSnapshot = bank;
await writeFile(dataPath, JSON.stringify(data, null, 2) + '\n');
console.log('Conciliação aplicada: encomendas abertas=' + openSaleIds.size +
  ', produtos contados=' + counted.size + ', reservas de embalagem=' + packagingReservations.size +
  ', compras ainda não recebidas=' + data.expenses.filter(e => e.receiptStatus === 'pending').length +
  ', compras históricas sem item=' + data.expenses.filter(e => e.legacyUnallocatedPurchase).length + '.');
