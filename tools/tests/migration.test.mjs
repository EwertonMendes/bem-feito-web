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
    assert.equal(data.expenses[0].businessDate, '2026-10-01');
    assert.equal(data.expenses[0].amountCents, 125);
    assert.equal(run('validate-export.mjs', dataPath).status, 0);
    data.inputs[0].stock = 3;
    await writeFile(dataPath, JSON.stringify(data));
    const failed = run('validate-export.mjs', dataPath);
    assert.equal(failed.status, 1);
    assert.match(failed.stderr, /histórico não reconcilia/);
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
