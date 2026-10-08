import { test, expect } from '@playwright/test';

test.use({
  baseURL: 'http://127.0.0.1:4200',
  browserName: 'chromium',
  viewport: { width: 1280, height: 800 },
  trace: 'retain-on-failure',
  screenshot: 'only-on-failure',
});

async function login(page) {
  await page.goto('/qa-e2e-login');
  await page.getByRole('button', { name: 'Entrar E2E' }).click();
  await expect(page).toHaveURL(/\/estoque$/, { timeout: 20000 });
  await expect(page.getByRole('heading', { name: 'Estoque' })).toBeVisible();
}

async function inventoryInput(page, name) {
  await page.goto('/estoque');
  await page.locator('.bf-segments').getByRole('button', { name: 'Insumos' }).click();
  const card = page.locator('.input-card').filter({ hasText: name });
  await expect(card).toBeVisible();
  return card;
}

async function adjustment(page, name) {
  const card = await inventoryInput(page, name);
  await card.getByRole('button', { name: /Ajustar|Conferir/ }).click();
  const dialog = page.locator('dialog[open]');
  await expect(dialog.getByRole('heading', { name: 'Ajustar estoque' })).toBeVisible();
  return { card, dialog, quantity: dialog.getByRole('textbox', { name: 'Quantidade do ajuste' }) };
}

test.describe('fluxo real de estoque com Firestore/Auth emulados', () => {
  test.describe.configure({ mode: 'serial' });
  test.beforeEach(async ({ page }) => { await login(page); });

  test('definir saldo total: mostra previsão, salva e persiste após reload', async ({ page }) => {
    const { card, dialog, quantity } = await adjustment(page, 'TESTE QA - Embalagem');
    await expect(dialog.getByRole('radio', { name: /Definir saldo total/ })).toBeChecked();
    await expect(quantity).toHaveValue('8');
    await quantity.fill('100');
    await expect(dialog.locator('.stock-preview-result strong')).toContainText('100');
    await expect(dialog.getByRole('textbox', { name: /Motivo/ })).toHaveValue('Conferência de inventário');
    await dialog.getByRole('button', { name: 'Registrar ajuste' }).click();
    await expect(dialog).not.toBeVisible();
    await expect(card.locator('.balance strong')).toHaveText('100');
    await page.reload();
    const reloaded = await inventoryInput(page, 'TESTE QA - Embalagem');
    await expect(reloaded.locator('.balance strong')).toHaveText('100');
  });

  test('somar ou subtrair: delta relativo e previsão correta em tempo real', async ({ page }) => {
    const { card, dialog, quantity } = await adjustment(page, 'TESTE QA - Embalagem');
    await dialog.getByRole('radio', { name: /Somar ou subtrair/ }).check();
    await expect(quantity).toHaveValue('0');
    await quantity.fill('-20');
    await expect(dialog.locator('.stock-preview-current strong')).toContainText('100');
    await expect(dialog.locator('.stock-preview-result strong')).toContainText('80');
    await dialog.getByRole('button', { name: 'Registrar ajuste' }).click();
    await expect(dialog).not.toBeVisible();
    await expect(card.locator('.balance strong')).toHaveText('80');
  });

  test('decréscimo maior que o saldo é limitado a zero, sem criar estoque negativo', async ({ page }) => {
    const { card, dialog, quantity } = await adjustment(page, 'TESTE QA - Embalagem');
    await dialog.getByRole('radio', { name: /Somar ou subtrair/ }).check();
    await quantity.fill('-150');
    await expect(dialog.locator('.stock-preview-result strong')).toContainText('0');
    await expect(dialog.getByText(/limitado a zero/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Registrar ajuste' }).click();
    await expect(dialog).not.toBeVisible();
    await expect(card.locator('.balance strong')).toHaveText('0');
    await card.getByRole('button', { name: 'Histórico' }).click();
    await expect(page.locator('dialog[open]').getByText('Ajuste', { exact: true }).first()).toBeVisible();
    await expect(page.locator('dialog[open]').getByText('-80', { exact: true })).toBeVisible();
  });

  test('não grava ajuste sem alteração e apresenta erro visível', async ({ page }) => {
    const { dialog } = await adjustment(page, 'TESTE QA - Embalagem');
    await dialog.getByRole('button', { name: 'Registrar ajuste' }).click();
    await expect(dialog.getByRole('alert')).toContainText('Não há alteração');
    await expect(dialog).toBeVisible();
  });

  test('motivo obrigatório: campo vazio exibe feedback, em vez de botão inerte', async ({ page }) => {
    const { dialog, quantity } = await adjustment(page, 'TESTE QA - Embalagem');
    await quantity.fill('12');
    await dialog.getByRole('textbox', { name: /Motivo/ }).fill('');
    await dialog.getByRole('button', { name: 'Registrar ajuste' }).click();
    await expect(dialog.getByRole('alert')).toContainText('motivo');
    await expect(dialog.getByText(/Informe o motivo do ajuste para o histórico/)).toBeVisible();
    await expect(dialog).toBeVisible();
  });

  test('saldo estimado aceita decimais e insumo não controlado não oferece ajuste', async ({ page }) => {
    const { card, dialog, quantity } = await adjustment(page, 'TESTE QA - Essência');
    await quantity.fill('10,25');
    await expect(dialog.locator('.stock-preview-result strong')).toContainText('10,25');
    await dialog.getByRole('button', { name: 'Registrar ajuste' }).click();
    await expect(dialog).not.toBeVisible();
    await expect(card.locator('.balance strong')).toHaveText('10.25');
    const untracked = await inventoryInput(page, 'TESTE QA - Fita');
    await expect(untracked).toContainText('Sem controle de saldo');
    await expect(untracked.getByRole('button', { name: /Ajustar|Conferir/ })).toHaveCount(0);
  });

  test('produto acabado exige saldo inteiro', async ({ page }) => {
    await page.goto('/estoque');
    const card = page.locator('.product-card').filter({ hasText: 'TESTE QA - Produto' });
    await expect(card).toBeVisible();
    await card.getByRole('button', { name: 'Ajustar' }).click();
    const dialog = page.locator('dialog[open]');
    const input = dialog.getByRole('textbox', { name: 'Quantidade do ajuste' });
    await input.fill('7');
    await dialog.getByRole('button', { name: 'Registrar ajuste' }).click();
    await expect(dialog).not.toBeVisible();
    await expect(card.locator('.balance strong')).toHaveText('7');
  });
});

test.describe('dropdown descritivo real no catálogo', () => {
  test.beforeEach(async ({ page }) => { await login(page); });
  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 520 }]) {
    test(`opções, ícones, check centralizado e último item rolável em ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto('/catalogo');
      await page.locator('.bf-segments').getByRole('button', { name: 'Insumos' }).click();
      const card = page.locator('.list-card').filter({ hasText: 'TESTE QA - Embalagem' });
      await expect(card).toBeVisible();
      await card.getByRole('button', { name: 'Editar' }).click();
      const dialog = page.locator('dialog[open]');
      const trigger = dialog.getByRole('combobox', { name: 'Controle de estoque' });
      await trigger.click();
      const menu = page.getByRole('listbox', { name: 'Controle de estoque' });
      await expect(menu.getByRole('option')).toHaveCount(3);
      for (const [name] of [['Controlado'], ['Estimado'], ['Não controlar saldo']]) {
        const option = menu.getByRole('option', { name: new RegExp('^' + name) });
        await expect(option.locator('bf-icon').first()).toBeVisible();
      }
      await menu.evaluate(el => { el.scrollTop = el.scrollHeight; });
      const last = menu.getByRole('option', { name: /^Não controlar saldo/ });
      await expect(last).toBeVisible();
      const menuBox = await menu.boundingBox();
      const lastBox = await last.boundingBox();
      expect(menuBox && lastBox).toBeTruthy();
      expect(lastBox.y + lastBox.height).toBeLessThanOrEqual(menuBox.y + menuBox.height + 3);

      // A selected marker is vertically centered in the same option.
      await trigger.click(); // close
      await trigger.click(); // reopen
      const selected = menu.locator('.option.selected');
      const optionBox = await selected.boundingBox();
      const markBox = await selected.locator('.selected-mark').boundingBox();
      expect(optionBox && markBox).toBeTruthy();
      expect(Math.abs((optionBox.y + optionBox.height / 2) - (markBox.y + markBox.height / 2))).toBeLessThan(6);
    });
  }
});
