import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const run = (script, ...args) => spawnSync(process.execPath, ['tools/migration/' + script, ...args], { encoding: 'utf8' });
test('Migration excludes template slots, converts Sheets dates, preserves source stocks and optional thresholds', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bem-feito-migration-test-'));
  try {
    const rawPath = join(dir, 'raw.json');
    const dataPath = join(dir, 'normalized.json');
    await writeFile(rawPath, JSON.stringify({ schemaVersion: 1, exportedAt: '2026-10-05T00:00:00Z', sheets: {
      Cadastros: [{ Cadastro_ID: 'u', Tipo: 'Unidade', Nome: 'kg', Ativo: 'Sim' }],
      Insumos: [
        { Insumo_ID: 'i', Insumo: 'TEST ONLY', 'Unidade Base': 'kg', Ativo: 'Sim', 'Estoque Inicial': 2, 'Estoque Atual': 2, 'Custo Médio Unit.': 19.475, 'Estoque Mínimo': '' },
        { Insumo_ID: 'reserved', Insumo: '', 'Unidade Base': 'un', Ativo: 'Não', 'Estoque Atual': 0 },
      ],
      Recebimentos: [{ Pagamento_ID: 'reserved' }], Produção: [{ Produção_ID: 'reserved' }],
      Produtos: [{ Produto_ID: 'reserved', Ativo: 'Não', 'Estoque Atual': 0, 'Estoque Mínimo': 3 }],
      'Compras e Despesas': [{ Mov_ID: 'e', Data: 46296.5, Tipo: 'Outro', 'Valor Total': 1.25 }],
    }}));
    assert.equal(run('normalize-legacy.mjs', rawPath, dataPath).status, 0);
    const data = JSON.parse(await readFile(dataPath, 'utf8'));
    assert.equal(data.inputs.length, 1);
    assert.equal(data.products.length, 0);
    assert.equal(data.payments.length, 0);
    assert.equal(data.productions.length, 0);
    assert.equal(data.inputs[0].minimumStockConfigured, false);
    assert.equal(data.inputs[0].stock, 2);
    assert.equal(data.inputs[0].stockStatus, 'untracked');
    assert.equal(data.expenses[0].businessDate, '2026-10-01');
    assert.equal(data.expenses[0].amountCents, 125);
    // The permanent migration additionally requires an explicitly reconciled bank snapshot.
    data.bankSnapshot = { businessDate: '2026-10-01', balanceCents: 0, ownerFundedCents: 0 };
    await writeFile(dataPath, JSON.stringify(data));
    assert.equal(run('validate-export.mjs', dataPath).status, 0);
    data.inputs[0].stock = 3;
    await writeFile(dataPath, JSON.stringify(data));
    const failed = run('validate-export.mjs', dataPath);
    assert.equal(failed.status, 1);
    assert.match(failed.stderr, /histórico não reconcilia/);
    const safe = spawnSync(process.execPath, ['tools/migration/validate-export.mjs', dataPath], {
      encoding: 'utf8',
      env: { ...process.env, MIGRATION_SAFE_DIAGNOSTICS: '1' },
    });
    assert.equal(safe.status, 1);
    const match = safe.stderr.match(/^MIGRATION_SAFE_DIAGNOSTICS=(.+)$/m);
    assert.ok(match);
    const diagnostic = JSON.parse(match[1]);
    assert.equal(diagnostic.categories['stock-ledger'], 1);
    assert.equal(diagnostic.count, 1);
    assert.equal(JSON.stringify(diagnostic).includes('inputs/i'), false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('Migration fails on malformed money instead of silently converting it to zero', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bem-feito-migration-test-'));
  try {
    const rawPath = join(dir, 'raw.json');
    await writeFile(rawPath, JSON.stringify({ sheets: { 'Compras e Despesas': [{ Mov_ID: 'e', Data: '2026-10-01', Tipo: 'Outro', 'Valor Total': 'not-a-number' }] } }));
    assert.notEqual(run('normalize-legacy.mjs', rawPath, join(dir, 'data.json')).status, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('Reconciliation ignores already-released reservations and uses the current physical stock', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bem-feito-reconcile-test-'));
  try {
    const rawPath = join(dir, 'raw.json');
    const dataPath = join(dir, 'data.json');
    await writeFile(rawPath, JSON.stringify({
      sheets: {
        Vendas: [
          { Venda_ID: 'past', 'Andamento da Encomenda': 'Entregue' },
          { Venda_ID: 'open', 'Andamento da Encomenda': 'Pronto' },
        ],
        Produtos: [{ Produto_ID: 'product', 'Estoque Físico': 7 }],
      },
      views: {
        'Reservas de Embalagem': [
          { Venda_ID: 'past', Insumo_ID: 'pack', 'Reserva atual': 0 },
          { Venda_ID: 'open', Insumo_ID: 'pack', 'Reserva atual': 1 },
        ],
        'Inventário 08-10': [
          { Produto_ID: 'product', 'Unidades físicas': 7, Destinação: 'Livre' },
          { Produto_ID: 'product', 'Unidades físicas': 58, Destinação: 'Reservado pedido antigo' },
        ],
      },
      sourceMetadata: { bankSnapshot: { balanceCents: 0, ownerFundedCents: 0, businessDate: '2026-10-09' } },
    }));
    await writeFile(dataPath, JSON.stringify({
      products: [{ id: 'product', stock: 2, minimumStock: 0 }],
      inputs: [{ id: 'pack', stock: 24, minimumStock: 0, averageUnitCostCents: 20 }],
      sales: [
        { id: 'past', status: 'active', items: [], stockEffects: [] },
        {
          id: 'open', status: 'active',
          items: [{ id: 'one', kind: 'product', quantity: 5, totalCostCents: 500 }],
          stockEffects: [{ itemType: 'product', itemId: 'product', quantityDelta: -5, unitCostCents: 100 }],
        },
      ],
      additions: [{ id: 'organza', name: 'Saquinho organza' }],
      expenses: [],
      stockMovements: [],
    }));
    const runResult = run('reconcile-legacy.mjs', rawPath, dataPath);
    assert.equal(runResult.status, 0, runResult.stderr);
    const result = JSON.parse(await readFile(dataPath, 'utf8'));
    assert.deepEqual(
      { physical: result.products[0].stock, committed: result.products[0].committedStock, reserved: result.products[0].reservedPhysicalStock },
      { physical: 7, committed: 5, reserved: 5 },
    );
    assert.deepEqual(
      { physical: result.inputs[0].stock, committed: result.inputs[0].committedStock, reserved: result.inputs[0].reservedPhysicalStock },
      { physical: 24, committed: 1, reserved: 1 },
    );
    assert.equal(result.sales[0].fulfillmentStatus, 'delivered');
    assert.equal(result.sales[1].fulfillmentStatus, 'ready');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
