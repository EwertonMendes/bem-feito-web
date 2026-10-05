function bemfeito_exportMigrationJson() {
  const ss = SpreadsheetApp.getActive();
  const timezone = ss.getSpreadsheetTimeZone();
  const definitions = [
    ['Vendas', 'Venda_ID'],
    ['Itens da Venda', 'Item_ID'],
    ['Recebimentos', 'Pagamento_ID'],
    ['Produção', 'Produção_ID'],
    ['Compras e Despesas', 'Mov_ID'],
    ['Produtos', 'Produto_ID'],
    ['Insumos', 'Insumo_ID'],
    ['Receitas', 'Receita_ID'],
    ['Ajustes de Estoque', 'Ajuste_ID'],
    ['Kits', 'Kit_ID'],
    ['Itens do Kit', 'Kit_Item_ID'],
    ['Cadastros', 'Cadastro_ID'],
    ['Preços de Formato', 'Preço_ID'],
    ['Adicionais', 'Adicional_ID'],
    ['Itens do Adicional', 'Adicional_Item_ID'],
    ['Consumos da Venda', 'Consumo_ID'],
  ];
  const sheets = {};

  definitions.forEach(([sheetName, key]) => {
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) return;
    const lastRow = sheet.getLastRow();
    const lastColumn = sheet.getLastColumn();
    if (lastRow < 4 || lastColumn < 1) {
      sheets[sheetName] = [];
      return;
    }
    const headers = sheet.getRange(4, 1, 1, lastColumn).getValues()[0].map(String);
    const rows = lastRow > 4 ? sheet.getRange(5, 1, lastRow - 4, lastColumn).getValues() : [];
    sheets[sheetName] = rows
      .map((row) => Object.fromEntries(headers.map((header, index) => [header, bemfeito_exportValue_(row[index], timezone)])))
      .filter((row) => row[key] !== '' && row[key] !== null && row[key] !== undefined);
  });

  const payload = {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    spreadsheetName: ss.getName(),
    sheets,
  };
  const stamp = Utilities.formatDate(new Date(), timezone, 'yyyyMMdd-HHmmss');
  const file = DriveApp.createFile(`bem-feito-legacy-${stamp}.json`, JSON.stringify(payload), MimeType.PLAIN_TEXT);
  SpreadsheetApp.getUi().alert(`Exportação criada no Google Drive:\n${file.getName()}`);
}

function bemfeito_exportValue_(value, timezone) {
  if (value instanceof Date) return Utilities.formatDate(value, timezone, 'yyyy-MM-dd');
  return value;
}
