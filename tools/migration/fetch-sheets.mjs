import { GoogleAuth } from 'google-auth-library';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const id = process.env.MIGRATION_SNAPSHOT_ID;
if (!id || !/^[A-Za-z0-9_-]+$/.test(id)) throw new Error('Snapshot ID ausente.');
const client = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
const token = await client.getAccessToken();
if (!token) throw new Error('Credencial OAuth do serviço indisponível.');
const base = 'https://sheets.googleapis.com/v4/spreadsheets/' + encodeURIComponent(id);
async function sheetsFetch(suffix) {
  const response = await fetch(base + suffix, { headers: { Authorization: 'Bearer ' + token } });
  if (!response.ok) throw new Error('Google Sheets indisponível ou sem permissão: HTTP ' + response.status);
  return response.json();
}
const metadata = await sheetsFetch('?fields=spreadsheetId,properties(title,timeZone),sheets(properties(title,gridProperties))');
const tabs = metadata.sheets.map(sheet => sheet.properties.title);
const mandatory = ['Vendas', 'Itens da Venda', 'Recebimentos', 'Produção', 'Compras e Despesas', 'Produtos', 'Insumos', 'Kits', 'Itens do Kit', 'Adicionais', 'Itens do Adicional', 'Cadastros', 'Preços de Formato'];
const missing = mandatory.filter(name => !tabs.includes(name));
if (missing.length) throw new Error('Abas obrigatórias ausentes: ' + missing.join(', '));
if (process.argv.includes('--preflight')) {
  console.log('Snapshot acessível por service account. Abas: ' + tabs.length + '; obrigatórias: ' + mandatory.length + '.');
  process.exit(0);
}
const optional = ['Receitas', 'Ajustes de Estoque', 'Consumos da Venda'];
const fullSource = [...mandatory, ...optional, 'Movimentações de Capital', 'Custos de Aquisição', 'Caixa e Aportes', 'Acompanhamento Encomendas', 'Reservas de Embalagem', 'Inventário 08-10', 'Controle Simplificado', 'Ficha de Produção'];
const selected = fullSource.filter(name => tabs.includes(name));
const ranges = selected.map(name => "'" + name.replace(/'/g, "''") + "'!A4:W1200");
const params = new URLSearchParams({ valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'SERIAL_NUMBER' });
for (const range of ranges) params.append('ranges', range);
const response = await sheetsFetch('/values:batchGet?' + params);
function dateSerial(value) {
  if (typeof value !== 'number' || value < 30000 || value > 90000) return value;
  return new Date(Math.round((value - 25569) * 86400000)).toISOString().slice(0, 10);
}
const dateColumns = new Set(['Data', 'Vencimento', 'Data da compra', 'Data do lote informada', 'Data Venda']);
const data = {};
for (let index = 0; index < selected.length; index++) {
  const values = response.valueRanges[index]?.values ?? [];
  const headers = (values[0] ?? []).map(String);
  data[selected[index]] = values.slice(1).map(row => Object.fromEntries(headers
    .filter(Boolean).map((header, i) => [header, dateColumns.has(header) ? dateSerial(row[i] ?? '') : (row[i] ?? '')])));
}
const keys = {
  'Vendas':'Venda_ID', 'Itens da Venda':'Item_ID', 'Recebimentos':'Pagamento_ID',
  'Produção':'Produção_ID', 'Compras e Despesas':'Mov_ID', 'Produtos':'Produto_ID',
  'Insumos':'Insumo_ID','Receitas':'Receita_ID','Ajustes de Estoque':'Ajuste_ID',
  'Kits':'Kit_ID','Itens do Kit':'Kit_Item_ID','Cadastros':'Cadastro_ID',
  'Preços de Formato':'Preço_ID','Adicionais':'Adicional_ID',
  'Itens do Adicional':'Adicional_Item_ID','Consumos da Venda':'Consumo_ID'
};
const sheets = {};
const views = {};
for (const [name, rows] of Object.entries(data)) {
  if (keys[name]) sheets[name] = rows.filter(row => row[keys[name]] !== '' && row[keys[name]] != null);
  else views[name] = rows.filter(row => Object.values(row).some(value => value !== '' && value != null));
}
const counts = Object.fromEntries(Object.entries(sheets).map(([name, rows]) => [name, rows.length]));
console.log('Fonte lida de snapshot privado; contagens operacionais:', JSON.stringify(counts));
if ((counts.Vendas ?? 0) < 25 || (counts.Recebimentos ?? 0) < 24 || (counts.Produção ?? 0) < 45) {
  throw new Error('Snapshot menor que a referência conciliada; abortando.');
}
const raw = {
  schemaVersion: 1, spreadsheetId: id, spreadsheetName: metadata.properties.title,
  exportedAt: new Date().toISOString(), sheets, views,
  sourceMetadata: {timeZone:metadata.properties.timeZone, sheetNames:tabs}
};
await mkdir(resolve('tools/migration'), {recursive:true});
await writeFile(resolve('tools/migration/legacy-raw.json'), JSON.stringify(raw));
console.log('Exportação disponível somente neste runner; não versione nem publique o JSON.');
