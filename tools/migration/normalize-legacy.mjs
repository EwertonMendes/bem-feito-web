import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const inputPath = resolve(process.argv[2] ?? 'tools/migration/legacy-raw.json');
const outputPath = resolve(process.argv[3] ?? 'tools/migration/migration-data.json');
const raw = JSON.parse(await readFile(inputPath, 'utf8'));
const sheets = raw.sheets ?? {};

const identityFields = {
  Vendas: ['Data', 'Cliente'], 'Itens da Venda': ['Venda_ID', 'Produto'], Recebimentos: ['Venda_ID', 'Data'],
  Produção: ['Produto_ID', 'Data'], 'Compras e Despesas': ['Tipo', 'Data'], Produtos: ['Nome de Exibição', 'Coleção'],
  Insumos: ['Insumo'], Receitas: ['Produto_ID', 'Insumo_ID'], 'Ajustes de Estoque': ['Tipo', 'Data'],
  Kits: ['Nome'], 'Itens do Kit': ['Kit_ID'], Cadastros: ['Tipo', 'Nome'], 'Preços de Formato': ['Coleção', 'Formato'],
  Adicionais: ['Nome'], 'Itens do Adicional': ['Adicional_ID'], 'Consumos da Venda': ['Venda_ID'],
};
const rows = (name) => (Array.isArray(sheets[name]) ? sheets[name] : []).filter((row) =>
  (identityFields[name] ?? []).some((field) => row[field] !== '' && row[field] !== null && row[field] !== undefined));
const text = (value) => value === null || value === undefined ? '' : String(value).trim();
const number = (value) => {
  if (value === '' || value === null || value === undefined) return 0;
  if (!Number.isFinite(Number(value))) throw new Error('A exportação contém um número inválido.');
  return Number(value);
};
const date = (value) => {
  if (typeof value === 'number') return new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86400000).toISOString().slice(0, 10);
  const result = text(value);
  if (!result) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || new Date(result + 'T00:00:00Z').toISOString().slice(0, 10) !== result) throw new Error('Data inválida na exportação.');
  return result;
};
const cents = (value) => Math.round(number(value) * 100);
const active = (value) => text(value).toLowerCase() === 'sim';
const lower = (value) => text(value).toLocaleLowerCase('pt-BR');
const omitEmpty = (object) => Object.fromEntries(Object.entries(object).filter(([, value]) => value !== '' && value !== undefined && value !== null));
const sequence = (value) => Number(text(value).match(/(\d+)$/)?.[1] ?? 0);
const byName = (items) => new Map(items.map((item) => [lower(item.name), item.id]));
const productStockStatus = (stock, minimumStock) => stock < 0 ? 'negative' : stock <= minimumStock ? 'low' : 'ok';
const inputStockStatus = (stock, minimumStock, configured, trackingMode) => trackingMode === 'untracked' || !configured ? 'untracked' : stock < 0 ? 'negative' : stock <= minimumStock ? 'low' : 'ok';
const saleAnalytics = (items) => {
  let cogsCents = 0;
  let itemsSold = 0;
  let missingCostItems = 0;
  for (const item of items) {
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

const cadastros = rows('Cadastros');
const typeRows = (type) => cadastros.filter((row) => text(row.Tipo) === type);
const simpleRegistry = (type) => typeRows(type).map((row) => ({
  id: text(row.Cadastro_ID),
  name: text(row.Nome),
  active: active(row.Ativo),
}));

const collections = simpleRegistry('Coleção');
const collectionIds = byName(collections);
const fragrances = typeRows('Fragrância').map((row) => ({
  id: text(row.Cadastro_ID),
  name: text(row.Nome),
  collectionId: collectionIds.get(lower(row.Pai)) ?? '',
  active: active(row.Ativo),
}));
const fragranceIds = new Map(fragrances.map((item) => [`${item.collectionId}:${lower(item.name)}`, item.id]));
const fragranceId = (name, collectionName) => {
  const collectionId = collectionIds.get(lower(collectionName));
  if (collectionId) return fragranceIds.get(`${collectionId}:${lower(name)}`) ?? '';
  const matches = fragrances.filter((item) => lower(item.name) === lower(name));
  if (matches.length > 1) throw new Error('Fragrância ambígua: informe a coleção.');
  return matches[0]?.id ?? '';
};
const formats = typeRows('Formato').map((row) => omitEmpty({
  id: text(row.Cadastro_ID),
  name: text(row.Nome),
  active: active(row.Ativo),
  approximateWeightGrams: number(row['Peso aprox. (g)']) || undefined,
}));
const formatIds = byName(formats);
const units = simpleRegistry('Unidade');
const unitIds = byName(units);
const paymentMethods = simpleRegistry('Forma de Pagamento');
const paymentMethodIds = byName(paymentMethods);
const expenseCategories = simpleRegistry('Categoria de Despesa');
const expenseCategoryIds = byName(expenseCategories);
const expenseTypes = typeRows('Tipo de Saída').map((row) => {
  const name = text(row.Nome);
  const kind = name === 'Compra de insumo'
    ? 'input-purchase'
    : name === 'Despesa operacional'
      ? 'operating-expense'
      : name === 'Equipamento / investimento'
        ? 'equipment'
        : 'other';
  return { id: text(row.Cadastro_ID), name, active: active(row.Ativo), kind };
});

const formatPrices = rows('Preços de Formato').map((row) => ({
  id: text(row.Preço_ID),
  collectionId: collectionIds.get(lower(row.Coleção)) ?? '',
  formatId: formatIds.get(lower(row.Formato)) ?? '',
  priceCents: cents(row.Preço),
  active: active(row.Ativo),
}));

// The private inventory review is authoritative about which inputs can be counted.
// Multiple rows may refer to the same bottle type (e.g. two Lavanda flasks).
const physicalReview = Array.isArray(raw.views?.['Controle Simplificado']) ? raw.views['Controle Simplificado'] : [];
const observationMap = new Map();
for (const observation of physicalReview) {
  const material = lower(observation.Material);
  // The Shopee Lauril (INS-021) is exhausted. The unmeasured Mercado Livre
  // flask is recorded under the legacy LAU-27 item, not the Shopee purchase.
  const id = text(observation['ID legado']) || (material === 'lauril vegetal' ? 'LAU-27' : '');
  if (!id) continue;
  const group = observationMap.get(id) ?? [];
  group.push(observation);
  observationMap.set(id, group);
}
const exhaustedInputs = new Set(rows('Ajustes de Estoque')
  .filter(row => lower(row.Motivo).includes('esgotado'))
  .map(row => text(row.Insumo_ID)).filter(Boolean));

const inputs = rows('Insumos').map((row) => {
  const stock = number(row['Estoque Atual']);
  const minimumStock = number(row['Estoque Mínimo']);
  const minimumStockConfigured = row['Estoque Mínimo'] !== '' && row['Estoque Mínimo'] !== null && row['Estoque Mínimo'] !== undefined;
  const id = text(row.Insumo_ID);
  const observations = observationMap.get(id) ?? [];
  const exact = observations.some(observation => lower(observation['Tipo de controle']) === 'exato');
  const liquid = lower(row['Unidade Base']) === 'ml' || /essência|corante|lauril/i.test(text(row.Insumo));
  const trackingMode = !physicalReview.length ? undefined
    : exact ? 'exact' : (observations.length || liquid) ? 'untracked' : minimumStockConfigured ? 'estimated' : 'untracked';
  const qualitative = observations
    .filter(observation => lower(observation['Tipo de controle']) !== 'exato')
    .map(observation => text(observation.Material) + ': ' + text(observation['Situação física']))
    .join(' · ');
  const availabilityStatus = qualitative || (exhaustedInputs.has(id) ? 'Esgotado' : '');
  return {
    id,
    code: id,
    active: active(row.Ativo),
    name: text(row.Insumo),
    unitId: unitIds.get(lower(row['Unidade Base'])) ?? '',
    stock,
    minimumStock,
    minimumStockConfigured,
    ...(trackingMode ? { trackingMode } : {}),
    ...(availabilityStatus ? { availabilityStatus: availabilityStatus.slice(0, 240) } : {}),
    stockStatus: inputStockStatus(stock, minimumStock, minimumStockConfigured, trackingMode),
    averageUnitCostCents: cents(row['Custo Médio Unit.']),
  };
});
const inputById = new Map(inputs.map((item) => [item.id, item]));

const recipeByProduct = new Map();
for (const row of rows('Receitas')) {
  const productId = text(row.Produto_ID);
  const inputId = text(row.Insumo_ID);
  const quantity = number(row['Qtd por Unidade']);
  if (!productId || !inputId || quantity <= 0) continue;
  const list = recipeByProduct.get(productId) ?? [];
  list.push({
    inputId,
    quantity,
    unitId: unitIds.get(lower(row.Unidade)) ?? inputById.get(inputId)?.unitId ?? '',
  });
  recipeByProduct.set(productId, list);
}

const products = rows('Produtos').map((row) => {
  const stock = number(row['Estoque Atual']);
  const minimumStock = number(row['Estoque Mínimo']);
  return {
    id: text(row.Produto_ID),
    code: text(row.Produto_ID),
    active: active(row.Ativo),
    collectionId: collectionIds.get(lower(row.Coleção)) ?? '',
    fragranceId: fragranceId(row.Fragrância, row.Coleção),
    formatId: formatIds.get(lower(row.Formato)) ?? '',
    displayName: text(row['Nome de Exibição']),
    salePriceCents: cents(row['Preço de Venda']),
    additionalCostCents: cents(row['Custo Adicional Unit.']),
    averageUnitCostCents: cents(row['Custo Unitário']),
    unitCostDeciCents: Math.round(number(row['Custo Unitário']) * 1000) || undefined,
    stock,
    minimumStock,
    stockStatus: productStockStatus(stock, minimumStock),
    recipe: recipeByProduct.get(text(row.Produto_ID)) ?? [],
  };
});
const productById = new Map(products.map((item) => [item.id, item]));

const kitComponents = new Map();
for (const row of rows('Itens do Kit')) {
  const kitId = text(row.Kit_ID);
  if (!kitId) continue;
  const list = kitComponents.get(kitId) ?? [];
  list.push(omitEmpty({
    id: text(row.Kit_Item_ID),
    formatId: formatIds.get(lower(row.Formato)) ?? '',
    quantity: number(row.Quantidade),
    collectionId: collectionIds.get(lower(row.Coleção)) || undefined,
    fragranceId: fragranceId(row['Fragrância fixa'], row.Coleção) || undefined,
    order: number(row.Ordem),
  }));
  kitComponents.set(kitId, list);
}

const kits = rows('Kits').map((row) => omitEmpty({
  id: text(row.Kit_ID),
  active: active(row.Ativo),
  name: text(row.Nome),
  priceCents: cents(row.Preço),
  notes: text(row.Observações) || undefined,
  components: (kitComponents.get(text(row.Kit_ID)) ?? []).sort((a, b) => a.order - b.order),
}));
const kitById = new Map(kits.map((item) => [item.id, item]));

const additionComponents = new Map();
for (const row of rows('Itens do Adicional')) {
  const additionId = text(row.Adicional_ID);
  if (!additionId) continue;
  const list = additionComponents.get(additionId) ?? [];
  list.push({
    id: text(row.Adicional_Item_ID),
    inputId: text(row.Insumo_ID),
    quantity: number(row.Quantidade),
    unitId: unitIds.get(lower(row.Unidade)) ?? inputById.get(text(row.Insumo_ID))?.unitId ?? '',
    order: number(row.Ordem),
  });
  additionComponents.set(additionId, list);
}

const additions = rows('Adicionais').map((row) => omitEmpty({
  id: text(row.Adicional_ID),
  active: active(row.Ativo),
  name: text(row.Nome),
  category: text(row.Categoria),
  priceCents: cents(row.Preço),
  notes: text(row.Observações) || undefined,
  components: (additionComponents.get(text(row.Adicional_ID)) ?? []).sort((a, b) => a.order - b.order),
}));
const additionById = new Map(additions.map((item) => [item.id, item]));

const productions = rows('Produção').map((row) => {
  const product = productById.get(text(row.Produto_ID));
  const quantity = number(row.Quantidade);
  const consumptions = (product?.recipe ?? []).map((component) => {
    const input = inputById.get(component.inputId);
    const consumedQuantity = component.quantity * quantity;
    const unitCostCents = input?.averageUnitCostCents ?? 0;
    return {
      inputId: component.inputId,
      quantity: consumedQuantity,
      unitId: component.unitId,
      unitCostCents,
      totalCostCents: Math.round(consumedQuantity * unitCostCents),
    };
  });
  const totalCostCents = consumptions.reduce((sum, item) => sum + item.totalCostCents, 0)
    + Math.round((product?.additionalCostCents ?? 0) * quantity);
  const unitCostCents = quantity > 0 ? Math.round(totalCostCents / quantity) : 0;
  return omitEmpty({
    id: text(row.Produção_ID),
    code: text(row.Produção_ID),
    businessDate: date(row.Data),
    productId: text(row.Produto_ID),
    productName: text(row.Produto),
    quantity,
    unitCostCents,
    totalCostCents,
    costPending: !product?.recipe?.length || unitCostCents <= 0,
    consumptions,
    notes: text(row.Observações) || undefined,
  });
});

const expenses = rows('Compras e Despesas').map((row) => {
  const type = text(row.Tipo);
  const kind = type === 'Compra de insumo'
    ? 'input-purchase'
    : type === 'Despesa operacional'
      ? 'operating-expense'
      : type === 'Equipamento / investimento'
        ? 'equipment'
        : 'other';
  return omitEmpty({
    id: text(row.Mov_ID),
    code: text(row.Mov_ID),
    businessDate: date(row.Data),
    kind,
    categoryId: expenseCategoryIds.get(lower(row.Categoria)) || undefined,
    inputId: text(row.Insumo_ID) || undefined,
    quantity: number(row.Quantidade) || undefined,
    unitId: unitIds.get(lower(row.Unidade)) || undefined,
    amountCents: cents(row['Valor Total']),
    paymentMethodId: paymentMethodIds.get(lower(row['Forma Pgto'])) || undefined,
    notes: text(row.Observações) || undefined,
    link: text(row.Link) || undefined,
  });
});

const stockAdjustments = rows('Ajustes de Estoque').map((row) => omitEmpty({
  id: text(row.Ajuste_ID),
  code: text(row.Ajuste_ID),
  businessDate: date(row.Data),
  itemType: text(row.Tipo) === 'Insumo' ? 'input' : 'product',
  itemId: text(row.Tipo) === 'Insumo' ? text(row.Insumo_ID) : text(row.Produto_ID),
  quantityDelta: number(row['Quantidade (+/-)']),
  reason: text(row.Motivo),
}));

const payments = rows('Recebimentos').map((row) => omitEmpty({
  id: text(row.Pagamento_ID),
  code: text(row.Pagamento_ID),
  saleId: text(row.Venda_ID),
  businessDate: date(row.Data),
  methodId: paymentMethodIds.get(lower(row.Forma)) ?? '',
  amountReceivedCents: cents(row['Valor Recebido']),
  appliedCents: cents(row['Aplicado à Venda']),
  tipCents: cents(row.Gorjeta),
  status: text(row.Situação) === 'Ativo' ? 'active' : 'reversed',
  notes: text(row.Observações) || undefined,
}));
const paymentsBySale = new Map();
for (const payment of payments) {
  const list = paymentsBySale.get(payment.saleId) ?? [];
  list.push(payment);
  paymentsBySale.set(payment.saleId, list);
}

const saleItemsBySale = new Map();
for (const row of rows('Itens da Venda')) {
  const saleId = text(row.Venda_ID);
  if (!saleId) continue;
  const list = saleItemsBySale.get(saleId) ?? [];
  list.push(row);
  saleItemsBySale.set(saleId, list);
}

const consumptionsBySale = new Map();
for (const row of rows('Consumos da Venda')) {
  const saleId = text(row.Venda_ID);
  if (!saleId) continue;
  const list = consumptionsBySale.get(saleId) ?? [];
  list.push(row);
  consumptionsBySale.set(saleId, list);
}

const sales = [];
for (const row of rows('Vendas')) {
  const saleId = text(row.Venda_ID);
  const sourceItems = saleItemsBySale.get(saleId) ?? [];
  const groups = new Map();
  for (const item of sourceItems) {
    const group = text(item.Grupo);
    if (!group) continue;
    const list = groups.get(group) ?? [];
    list.push(item);
    groups.set(group, list);
  }

  const saleLines = [];
  const stockEffects = new Map();
  const addEffect = (itemType, itemId, quantityDelta, unitCostCents) => {
    if (!itemId || !quantityDelta) return;
    const key = `${itemType}:${itemId}`;
    const current = stockEffects.get(key);
    stockEffects.set(key, {
      itemType,
      itemId,
      quantityDelta: (current?.quantityDelta ?? 0) + quantityDelta,
      unitCostCents: current?.unitCostCents ?? unitCostCents,
    });
  };

  for (const item of sourceItems) {
    const lineType = text(item['Tipo de Linha']) || 'Produto';

    if (lineType === 'Componente') {
      addEffect('product', text(item.Produto_ID), -number(item.Quantidade), cents(item['Custo Unit.']));
      continue;
    }

    if (lineType === 'Kit') {
      const kitId = text(item.Kit_ID);
      const components = (groups.get(text(item.Grupo)) ?? [])
        .filter((component) => text(component['Tipo de Linha']) === 'Componente')
        .map((component) => ({
          productId: text(component.Produto_ID),
          name: text(component.Produto),
          quantity: number(component.Quantidade),
          unitCostCents: cents(component['Custo Unit.']),
        }));
      const totalCostCents = components.reduce((sum, component) => sum + component.unitCostCents * component.quantity, 0);
      saleLines.push({
        id: text(item.Item_ID),
        kind: 'kit',
        sourceId: kitId,
        name: kitById.get(kitId)?.name ?? text(item.Produto).replace(/^Kit · /, ''),
        quantity: number(item.Quantidade) || 1,
        unitPriceCents: cents(item['Preço Aplicado']),
        unitCostCents: totalCostCents,
        totalCents: cents(item['Total Item']),
        totalCostCents,
        components,
      });
      continue;
    }

    if (lineType === 'Adicional') {
      const additionId = text(item.Adicional_ID);
      saleLines.push({
        id: text(item.Item_ID),
        kind: 'addition',
        sourceId: additionId,
        name: additionById.get(additionId)?.name ?? text(item.Produto),
        quantity: number(item.Quantidade),
        unitPriceCents: cents(item['Preço Aplicado']),
        unitCostCents: cents(item['Custo Unit.']),
        totalCents: cents(item['Total Item']),
        totalCostCents: cents(item['Custo Total']),
      });
      continue;
    }

    const productId = text(item.Produto_ID);
    saleLines.push({
      id: text(item.Item_ID),
      kind: 'product',
      sourceId: productId,
      name: text(item.Produto),
      quantity: number(item.Quantidade),
      unitPriceCents: cents(item['Preço Aplicado']),
      unitCostCents: cents(item['Custo Unit.']),
      totalCents: cents(item['Total Item']),
      totalCostCents: cents(item['Custo Total']),
    });
    addEffect('product', productId, -number(item.Quantidade), cents(item['Custo Unit.']));
  }

  for (const consumption of consumptionsBySale.get(saleId) ?? []) {
    addEffect('input', text(consumption.Insumo_ID), -number(consumption.Quantidade), cents(consumption['Custo Unit.']));
  }

  const salePayments = paymentsBySale.get(saleId) ?? [];
  const status = text(row.Situação) === 'Cancelada' ? 'cancelled' : 'active';
  const balanceCents = status === 'cancelled' ? 0 : cents(row['A Receber']);
  const receivedCents = cents(row['Recebido na Venda']);
  const totalCents = cents(row['Total da Venda']);

  sales.push(omitEmpty({
    id: saleId,
    code: saleId,
    businessDate: date(row.Data),
    customerName: text(row.Cliente) || undefined,
    dueDate: date(row.Vencimento) || undefined,
    discountCents: cents(row.Desconto),
    subtotalCents: cents(row['Total dos Itens']),
    totalCents,
    receivedCents,
    tipCents: cents(row.Gorjetas),
    balanceCents,
    paymentStatus: status === 'cancelled' ? 'cancelled' : balanceCents <= 0 ? 'paid' : receivedCents > 0 ? 'partial' : 'pending',
    status,
    notes: text(row.Observações) || undefined,
    items: saleLines,
    paymentIds: salePayments.map((payment) => payment.id),
    stockEffects: [...stockEffects.values()],
    ...saleAnalytics(saleLines),
  }));
}

const stockMovements = [];

for (const product of products) {
  const legacy = rows('Produtos').find((row) => text(row.Produto_ID) === product.id);
  const opening = number(legacy?.['Estoque Inicial']);
  if (!opening) continue;
  stockMovements.push({
    id: `migration-opening-product-${product.id}`,
    itemType: 'product',
    itemId: product.id,
    quantityDelta: opening,
    unitCostCents: product.averageUnitCostCents,
    totalCostCents: Math.round(Math.abs(opening) * product.averageUnitCostCents),
    sourceType: 'migration',
    sourceId: 'legacy-opening-balance',
    businessDate: raw.openingBalanceDate ?? productions.map((item) => item.businessDate).concat(sales.map((item) => item.businessDate), expenses.map((item) => item.businessDate)).sort()[0] ?? date(raw.exportedAt?.slice(0, 10)),
  });
}

for (const input of inputs) {
  const legacy = rows('Insumos').find((row) => text(row.Insumo_ID) === input.id);
  const opening = number(legacy?.['Estoque Inicial']);
  if (!opening) continue;
  stockMovements.push({
    id: `migration-opening-input-${input.id}`,
    itemType: 'input',
    itemId: input.id,
    quantityDelta: opening,
    unitCostCents: input.averageUnitCostCents,
    totalCostCents: Math.round(Math.abs(opening) * input.averageUnitCostCents),
    sourceType: 'migration',
    sourceId: 'legacy-opening-balance',
    businessDate: raw.openingBalanceDate ?? productions.map((item) => item.businessDate).concat(sales.map((item) => item.businessDate), expenses.map((item) => item.businessDate)).sort()[0] ?? date(raw.exportedAt?.slice(0, 10)),
  });
}

for (const production of productions) {
  stockMovements.push({
    id: `migration-production-${production.id}`,
    itemType: 'product',
    itemId: production.productId,
    quantityDelta: production.quantity,
    unitCostCents: production.unitCostCents,
    totalCostCents: production.totalCostCents,
    sourceType: 'production',
    sourceId: production.id,
    businessDate: production.businessDate,
  });
  for (const consumption of production.consumptions) {
    stockMovements.push({
      id: `migration-production-${production.id}-input-${consumption.inputId}`,
      itemType: 'input',
      itemId: consumption.inputId,
      quantityDelta: -consumption.quantity,
      unitCostCents: consumption.unitCostCents,
      totalCostCents: consumption.totalCostCents,
      sourceType: 'production',
      sourceId: production.id,
      businessDate: production.businessDate,
    });
  }
}

for (const expense of expenses.filter((item) => item.kind === 'input-purchase' && item.inputId && item.quantity)) {
  stockMovements.push({
    id: `migration-purchase-${expense.id}`,
    itemType: 'input',
    itemId: expense.inputId,
    quantityDelta: expense.quantity,
    unitCostCents: Math.round(expense.amountCents / expense.quantity),
    totalCostCents: expense.amountCents,
    sourceType: 'purchase',
    sourceId: expense.id,
    businessDate: expense.businessDate,
  });
}

for (const adjustment of stockAdjustments) {
  const entity = adjustment.itemType === 'product' ? productById.get(adjustment.itemId) : inputById.get(adjustment.itemId);
  stockMovements.push({
    id: `migration-adjustment-${adjustment.id}`,
    itemType: adjustment.itemType,
    itemId: adjustment.itemId,
    quantityDelta: adjustment.quantityDelta,
    unitCostCents: entity?.averageUnitCostCents ?? 0,
    totalCostCents: Math.round(Math.abs(adjustment.quantityDelta) * (entity?.averageUnitCostCents ?? 0)),
    sourceType: 'adjustment',
    sourceId: adjustment.id,
    businessDate: adjustment.businessDate,
  });
}

for (const sale of sales.filter((item) => item.status !== 'cancelled')) {
  for (const effect of sale.stockEffects) {
    stockMovements.push({
      id: `migration-sale-${sale.id}-${effect.itemType}-${effect.itemId}`,
      itemType: effect.itemType,
      itemId: effect.itemId,
      quantityDelta: effect.quantityDelta,
      unitCostCents: effect.unitCostCents,
      totalCostCents: Math.round(Math.abs(effect.quantityDelta) * effect.unitCostCents),
      sourceType: 'sale',
      sourceId: sale.id,
      businessDate: sale.businessDate,
    });
  }
}

const counters = [
  ['sale', Math.max(0, ...sales.map((item) => sequence(item.code)))],
  ['payment', Math.max(0, ...payments.map((item) => sequence(item.code)))],
  ['production', Math.max(0, ...productions.map((item) => sequence(item.code)))],
  ['expense', Math.max(0, ...expenses.map((item) => sequence(item.code)))],
  ['stockAdjustment', Math.max(0, ...stockAdjustments.map((item) => sequence(item.code)))],
].map(([id, value]) => ({ id, value }));

const result = {
  schemaVersion: 1,
  source: {
    spreadsheetId: text(raw.spreadsheetId),
    timeZone: text(raw.timeZone),
    spreadsheetName: text(raw.spreadsheetName),
    exportedAt: text(raw.exportedAt),
  },
  collections,
  fragrances,
  formats,
  formatPrices,
  units,
  paymentMethods,
  expenseCategories,
  expenseTypes,
  inputs,
  products,
  kits,
  additions,
  expenses,
  productions,
  sales,
  payments,
  stockAdjustments,
  stockMovements,
  counters,
};

await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);
console.log('Totais normalizados (somente quantidades):', JSON.stringify(Object.fromEntries(
  Object.entries(result).filter(([,rows]) => Array.isArray(rows)).map(([key, rows]) => [key, rows.length])
)));
console.log(`Arquivo normalizado criado em ${outputPath}`);
