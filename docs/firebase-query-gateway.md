# Firebase Query Gateway — Firestore DEV por GitHub Actions

## Objetivo e fronteiras

Consultas **somente leitura** ao Firestore `bem-feito-dev` através do workflow já confiável `.github/workflows/data-admin.yml`, iniciado por `workflow_dispatch` pelo GitHub MCP Actions. **Nenhum PR, commit operacional, token de longa duração ou acesso PROD** é necessário para consultar. PRs continuam obrigatórios para implementar alterações de código; os modos administrativos de gravação, migração e recuperação permanecem separados e inalterados.

A execução ocorre somente na `master` protegida, com CI de push confirmada e com a identidade OIDC `github-data-dev-read@bem-feito-dev.iam.gserviceaccount.com`, no ambiente existente `data-dev-preview`. Antes de obter credenciais o gate valida o proprietário humano do repositório, as permissões atuais, a integridade do evento, o estado da master, os limites e a chave de retorno; tudo é revalidado na execução. Tentativas de enviar IDs de PR ou parâmetros de escrita juntamente com `mode=query` são rejeitadas.

## Fluxo do assistente

1. Interpretar a pergunta do usuário e **planejar a menor consulta possível**, preferindo filtros por data, código, status ou ID. Não fazer consultas exploratórias sucessivas desnecessárias.
2. Gerar localmente uma chave RSA efêmera de **3072 bits**; manter a chave privada fora do GitHub, do repositório e dos logs. Enviar apenas a chave pública SPKI DER em base64url no `recipient_public_key`.
3. Usar `actions_run_trigger` com `method=run_workflow`, `workflow_id=data-admin.yml`, `ref=master` e `inputs` contendo `mode=query`, `query=<JSON>` e `recipient_public_key=<chave pública>`.
4. Acompanhar a execução e ler o job `Query DEV (encrypted, read-only)`. A linha `BF_QUERY_ENCRYPTED_V1=` traz **somente** um envelope cifrado.
5. Descriptografar **localmente**: base64url do envelope JSON; RSA-OAEP/SHA-256 para `key`; AES-256-GCM com `iv`, `tag` e AAD `queryHash` para `data`. Conferir que o SHA-256 do JSON de entrada coincide com `queryHash`.
6. Analisar o conteúdo privado apenas na conversa com o proprietário. Nunca copiar o resultado em comentários, logs ou arquivos públicos.

### Exemplo de plano

```json
{
  "schemaVersion": 1,
  "environment": "dev",
  "projectId": "bem-feito-dev",
  "queries": [
    {
      "name": "producao",
      "collection": "productions",
      "filters": [{ "field": "businessDate", "op": "==", "value": "2026-10-10" }],
      "limit": 15
    },
    {
      "name": "movimentacoes",
      "collection": "stockMovements",
      "filters": [
        { "field": "businessDate", "op": "==", "value": "2026-10-10" },
        { "field": "sourceType", "op": "==", "value": "production" }
      ],
      "limit": 30
    }
  ],
  "lookups": [
    { "name": "insumos", "from": "producao", "path": "consumptions[].inputId", "collection": "inputs", "limit": 20 },
    { "name": "produtos", "from": "producao", "path": "items[].productId", "collection": "products", "limit": 20 }
  ]
}
```

Cada consulta precisa ter pelo menos um filtro e um `limit`, até **4 consultas** por execução, **4 lookups**, até **40 documentos** por consulta/lookup e soma máxima de **120 documentos planejados** por execução. São permitidos apenas campos seguros, coleções de negócio liberadas e operadores `==`, `<`, `<=`, `>`, `>=` e `in` (máximo 10 valores). `orderBy` e `select` são opcionais. Lookups buscam documentos por ID, extraído de campos de resultados anteriores, e não varrem coleções.

**Limitações de custo:** o orçamento de 120 é um limite por execução, não um orçamento diário global. Leituras mínimas de consultas vazias, índices e agregações podem consumir operações adicionais; `readEstimate` **não é faturamento exato**. Não há cache persistente nem medidor global de quota nesta versão. O assistente deve evitar repetições, restringir períodos e solicitar autorização para ampliar o escopo em outra revisão da implementação. Índices compostos inexistentes causam falha segura sem expor mensagens internas.

**Privacidade:** os parâmetros de dispatch podem ser inspecionáveis por pessoas com acesso ao GitHub. Nunca enviar nomes de clientes, telefones, endereços, notas privadas ou segredos como valores de filtros ou outras entradas do workflow. Buscar por período/código e resolver a identidade sobre os dados **já descriptografados localmente**. O resultado de negócio completo é cifrado com RSA-OAEP + AES-256-GCM antes de aparecer no log. A chave privada deve permanecer efêmera e não deve ser enviada a Actions. Resultados acima de 75 KB são rejeitados para evitar divulgação, truncamento e respostas pesadas.

## Validação e operação

- `npm run check:data-admin` e `npm run test:data-admin` cobrem schemas e autenticação criptográfica.
- CI da `master` precisa passar antes da Action real receber acesso OIDC.
- Consultas de teste devem confirmar `mode=query` via MCP, login do proprietário, ausência de escrita, leitura real no DEV e decriptação privada, comparando os registros à interface do sistema.
- Aplicações de migração continuam exigindo plano, hashes, prévia, backup e autorização explícita; a query não tem caminho para usar a conta de escrita.


## Administração DEV direta (sem PR por operação)

O workflow `.github/workflows/data-admin.yml` aceita `workflow_dispatch` com `mode=direct` e
`operation=<JSON>`; a consulta com `mode=query` permanece criptografada. As alterações
diretas somente funcionam na `master` protegida, para o proprietário autenticado e
com a CI da master aprovada. Usam OIDC efêmero para a identidade escritora DEV.
Não é necessário PR, arquivo de requisição, comentário, chave de serviço ou servidor ligado.

Exemplo de atualização sem alterar campos derivados:

```json
{"schemaVersion":1,"id":"patch-example-001","environment":"dev","projectId":"bem-feito-dev","action":"patch","collection":"products","documentId":"product-id","expected":{"salePriceCents":1000},"values":{"salePriceCents":1100}}
```

Outros comandos reutilizáveis: `create`, `delete` (somente registros permitidos e
sem dependências), `adjustStock` (movimento + ajuste + contador) e `reverseProduction`
(remove produção e movimentações e reverte somente saldos que não foram consumidos
ou reservados posteriormente). A operação é limitada a um escopo pequeno, tem
ID de idempotência, backup em projeto privado separado, commit atômico, auditoria e
verificação pós-escrita. Repetir o mesmo ID não reaplica alterações.

Exemplos de ajustes e reversão:

```json
{"schemaVersion":1,"id":"reverse-example-001","environment":"dev","projectId":"bem-feito-dev","action":"reverseProduction","documentId":"production-id"}
{"schemaVersion":1,"id":"stock-example-001","environment":"dev","projectId":"bem-feito-dev","action":"adjustStock","itemType":"product","itemId":"product-id","quantityDelta":1,"reason":"Conferência de estoque","businessDate":"2026-10-10"}
```

Os parâmetros do dispatch não são criptografados: **não incluir dados pessoais
ou segredos**. A política de campos editáveis impede alterar diretamente estoque,
reservas, pagamentos e demais dados derivados. Operações financeiras complexas
devem usar o fluxo da aplicação ou uma operação de negócio específica revisada.

Nota: produção histórica pode não conter o custo médio anterior. A reversão
recompõe quantidades e remove movimentos correspondentes, mas não promete
restaurar campos sem snapshot confiável. Contadores sequenciais permanecem
monotônicos para evitar reutilização de códigos.

A administração legada de PR/preview/apply fica reservada a migrações e
recuperações extraordinárias, não à operação cotidiana.
