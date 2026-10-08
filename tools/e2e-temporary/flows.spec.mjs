import { test, expect } from '@playwright/test';

test.use({
  baseURL:'http://127.0.0.1:4200',
  browserName:'chromium', viewport:{width:1280,height:800},
  trace:'retain-on-failure', screenshot:'only-on-failure',
});
async function login(page){
  await page.goto('/qa-e2e-login');
  await page.getByRole('button',{name:'Entrar E2E'}).click();
  await expect(page).toHaveURL(/\/estoque$/, {timeout:30000});
}
async function choose(page,combobox,option){
  await combobox.click();
  await page.getByRole('option',{name:new RegExp('^'+option)}).click();
}
test.beforeEach(async ({page})=>{await login(page)});

test('batch production consolidates multiple products and repeated entries for the same date',async({page})=>{
  await page.goto('/producao');
  await page.getByRole('button',{name:'Registrar produção'}).click();
  const d=page.locator('dialog[open]');
  await d.locator('input[type=date]').fill('2026-10-05');
  await choose(page,d.getByRole('combobox',{name:'Produto produzido'}).nth(0),'TESTE QA - Produto 1');
  await d.getByRole('textbox',{name:'Quantidade produzida'}).nth(0).fill('2');
  await d.getByRole('button',{name:'Adicionar outro produto'}).click();
  await choose(page,d.getByRole('combobox',{name:'Produto produzido'}).nth(1),'TESTE QA - Produto 2');
  await d.getByRole('textbox',{name:'Quantidade produzida'}).nth(1).fill('3');
  await expect(d.getByText('5 unidades')).toBeVisible();
  await d.getByRole('button',{name:'Confirmar produção'}).click();
  await expect(d).not.toBeVisible();
  const day=page.locator('.day-card').filter({hasText:'05/10/2026'});
  await expect(day).toBeVisible();
  await expect(day.locator('.day-stats strong').first()).toHaveText('5');
  await day.getByRole('button',{name:'Adicionar ao dia'}).click();
  const d2=page.locator('dialog[open]');
  await choose(page,d2.getByRole('combobox',{name:'Produto produzido'}),'TESTE QA - Produto 1');
  await d2.getByRole('button',{name:'Confirmar produção'}).click();
  await expect(day.locator('.day-stats strong').first()).toHaveText('6');
  await day.getByRole('button',{name:'Ver detalhes'}).click();
  const details=page.locator('dialog[open]');
  await expect(details.getByRole('heading',{name:/Produção de/})).toBeVisible();
  await expect(details.getByText('TESTE QA - Produto 1')).toBeVisible();
  await expect(details.getByText('TESTE QA - Produto 2')).toBeVisible();
  await expect(details.getByText(/manhã|tarde/i)).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.day-card').filter({hasText:'05/10/2026'}).locator('.day-stats strong').first()).toHaveText('6');
});

test('one financial purchase contains several inputs, updates inventory and shows details',async({page})=>{
  await page.goto('/financeiro');
  await page.getByRole('button',{name:'Nova saída'}).click();
  const d=page.locator('dialog[open]');
  await d.getByRole('button',{name:'Compra de insumo'}).click();
  let row=d.locator('.purchase-line').first();
  await choose(page,row.getByRole('combobox',{name:'Insumo comprado'}),'Embalagem QA');
  await row.getByRole('textbox',{name:'Quantidade comprada'}).fill('5');
  await row.getByRole('textbox',{name:'Valor deste insumo'}).fill('50');
  await d.getByRole('button',{name:'Adicionar insumo'}).click();
  row=d.locator('.purchase-line').nth(1);
  await choose(page,row.getByRole('combobox',{name:'Insumo comprado'}),'Essência QA');
  await row.getByRole('textbox',{name:'Quantidade comprada'}).fill('2');
  await row.getByRole('textbox',{name:'Valor deste insumo'}).fill('20');
  await expect(d.locator('.purchase-line')).toHaveCount(2);
  await d.getByRole('button',{name:'Registrar',exact:true}).click();
  await expect(d).not.toBeVisible();
  const table=page.locator('.bf-table tbody tr').filter({hasText:'2 insumo(s)'});
  await expect(table).toBeVisible();
  await table.getByRole('button',{name:'Ver'}).click();
  const details=page.locator('dialog[open]');
  await expect(details.getByText('Embalagem QA')).toBeVisible();
  await expect(details.getByText('Essência QA')).toBeVisible();
});

test('kit of 100 edits quantities by product, not one select for every unit',async({page})=>{
  await page.goto('/vendas');
  await page.getByRole('button',{name:'Nova venda'}).click();
  const d=page.locator('dialog[open]');
  await d.getByRole('button',{name:'Kits'}).click();
  const kit=d.locator('.pick-card').filter({hasText:'TESTE QA - Kit 100'});
  await expect(kit).toBeVisible();
  await kit.getByRole('button',{name:'Adicionar',exact:true}).click();
  await expect(d.locator('.kit-allocation')).toHaveCount(1);
  await expect(d.locator('.kit-allocation-row')).toHaveCount(1);
  await d.getByRole('textbox',{name:'Quantidade de TESTE QA - Produto 1'}).fill('35');
  const select=d.getByRole('combobox',{name:/Adicionar fragrância/});
  await choose(page,select,'TESTE QA - Produto 2');
  await d.getByRole('textbox',{name:'Quantidade de TESTE QA - Produto 2'}).fill('35');
  await choose(page,select,'TESTE QA - Produto 3');
  await d.getByRole('textbox',{name:'Quantidade de TESTE QA - Produto 3'}).fill('30');
  await expect(d.locator('.kit-allocation-head')).toContainText('100 / 100 un.');
  await expect(d.locator('.kit-allocation-row')).toHaveCount(3);
  await d.getByPlaceholder(/Nome do cliente/).fill('Cliente QA');
  await d.getByRole('button',{name:/Confirmar venda/}).click();
  await expect(d).not.toBeVisible();
  await expect(page.getByRole('table').getByText('Cliente QA')).toBeVisible();
});

test('catalog links open production with product preselected and contextual price can be applied',async({page})=>{
  await page.goto('/catalogo');
  const card=page.locator('.catalog-card').filter({hasText:'TESTE QA - Produto 3'});
  await card.getByRole('link',{name:'Produzir'}).click();
  await expect(page).toHaveURL(/\/producao/);
  const d=page.locator('dialog[open]');
  await expect(d.getByRole('combobox',{name:'Produto produzido'})).toContainText('TESTE QA - Produto 3');
  await d.getByRole('button',{name:'Cancelar'}).click();
  await page.goto('/catalogo');
  await page.getByRole('button',{name:'Novo',exact:true}).click();
  const product=page.locator('dialog[open]');
  await choose(page,product.getByRole('combobox',{name:'Coleção'}),'Clássico QA');
  await choose(page,product.getByRole('combobox',{name:'Fragrância'}),'Lavanda QA');
  await choose(page,product.getByRole('combobox',{name:'Formato'}),'Florzinha QA');
  await expect(product.getByRole('button',{name:/Usar preço padrão/})).toBeVisible();
});

test('mobile production and purchases keep modal actions usable',async({page})=>{
  await page.setViewportSize({width:390,height:760});
  await page.goto('/producao');
  await page.getByRole('button',{name:'Registrar produção'}).click();
  const d=page.locator('dialog[open]');
  await d.getByRole('button',{name:'Adicionar outro produto'}).click();
  await expect(d.getByRole('button',{name:'Confirmar produção'})).toBeVisible();
  await d.getByRole('button',{name:'Cancelar'}).click();
  await page.goto('/financeiro');
  await page.getByRole('button',{name:'Nova saída'}).click();
  await page.locator('dialog[open]').getByRole('button',{name:'Compra de insumo'}).click();
  await expect(page.locator('dialog[open]').getByRole('button',{name:'Adicionar insumo'})).toBeVisible();
});
