# Produtos multicategoria — Bem Feito Web

## Escopo
- Sabonetes legados continuam válidos sem `categoryId` (`soap` no normalizador).
- Novas categorias: `creative-kit`, `scented-candle`. São produtos acabados em `products`, nunca documentos na coleção legada `kits`.
- Os 10 novos SKUs do Sheets são `PROD-094` a `PROD-103`, com estoque inicial zero, sem receitas nem consumos novos.
- O preço vem de `Preço Específico` da planilha; venda salva classificação e preço no snapshot histórico.
- `collectionId`, `fragranceId` e `formatId` permanecem obrigatórios somente para sabonetes.

## Migração protegida (somente DEV)
O registro `product-categories-v1` utiliza a cópia privada de 20/10 guardada em `config.environments.dev.categorySnapshotId`.
Só pode executar pelo workflow de administração confiável, com prévia, hash de autorização, backup independente e readback; jamais por script local com token compartilhado.
O plano lê os produtos existentes e **rejeita** divergências de quantidade e identidades legadas. Mantém seus campos financeiros e de estoque intocados, adicionando só `categoryId: soap`. Cria exatamente os dez novos produtos, exigindo ausência prévia dos IDs. Não escreve em `sales`, `productions`, `stockMovements`, `inputs` nem em dados de usuários.
O pedido protegido usa:
```json
{
  "schemaVersion": 1,
  "id": "dev-product-categories-20261020-v1",
  "environment": "dev",
  "projectId": "bem-feito-dev",
  "operation": "migrate",
  "migration": "product-categories-v1",
  "deploymentSha": "<SHA_DE_MASTER_PUBLICADO_EM_DEV>",
  "destructive": { "projectId": "bem-feito-dev", "paths": ["products"] }
}
```
Substituir o SHA somente após publicar essa versão. Nunca executar enquanto a sincronização histórica PR #67 estiver pendente. Confirmar na prévia exatos 82 updates de categoria e 10 creates; nenhum delete.

## Limites intencionais
Receitas e baixas de insumos permanecem no estado anterior; não criar composição fictícia. Custos pendentes não são margem de 100%.
A planilha é fonte da **migração inicial**, não sincronização bidirecional contínua. Futuras categorias exigem definir atributos e validações próprias, mantendo os mesmos fluxos comerciais.
