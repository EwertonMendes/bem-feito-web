# Estratégia de leituras do Firestore

O Bem Feito é desenhado para operar com folga no free tier do Firestore sem sacrificar consistência entre os usuários.

## Princípios

- Navegação não é motivo para reler dados que o aplicativo já possui.
- Uma mutation atualiza o estado local a partir do resultado da própria transaction; ela não dispara um reload completo.
- Listas históricas usam paginação por cursor, com páginas de 40 registros.
- Métricas do Dashboard usam aggregation queries e campos derivados indexáveis, em vez de baixar históricos inteiros.
- Dados compartilhados mantêm um único canal leve de invalidação em `system/data-revisions`.
- A cache persistente oficial do SDK do Firestore é habilitada em múltiplas abas.
- Security Rules não são enfraquecidas para economizar leituras.

## Stores

Stores com dados reutilizáveis usam `AsyncLoadGate`:

- a primeira carga chega ao Firestore;
- chamadas concorrentes são deduplicadas;
- uma navegação posterior reutiliza a carga em memória;
- uma revisão remota invalida o cache sem duplicar requests em andamento;
- mudanças apenas de estoque usam o domínio de inventário, permitindo atualizar produtos/insumos sem reler kits, adicionais ou referências estáveis;
- stores só fazem refresh imediato quando existe uma tela consumidora ativa; fora dela, os dados ficam marcados como stale e são atualizados na próxima entrada.

Nenhuma página ou componente deve chamar `.load(true)`. Refresh forçado pertence à camada de store, como reação a invalidação controlada.

## Paginação

Vendas, despesas, recebimentos, produções, contas a receber e movimentos de estoque usam cursor estável com o campo de ordenação e `documentId()`.

O botão "Carregar mais" acrescenta a próxima página sem reler as páginas já carregadas.

## Dashboard

O Dashboard não depende de SalesStore, FinanceStore ou CatalogStore.

Valores como faturamento, recebimentos, despesas, quantidade de vendas e contas a receber são calculados por aggregation queries. Vendas persistem os campos derivados:

- `analyticsVersion`
- `cogsCents`
- `itemsSold`
- `missingCostItems`

Produtos e insumos persistem `stockStatus`, permitindo contagens de estoque baixo/negativo por índice.

Esses campos são derivados no mesmo fluxo transacional que altera os dados de origem, portanto não são uma segunda fonte manual de verdade.

O Dashboard também mantém cache próprio de métricas e do gráfico anual. Sair e voltar para a tela não executa novas agregações quando nenhum domínio relevante mudou; revisões de vendas invalidam período e gráfico, enquanto revisões de financeiro/estoque invalidam apenas as métricas afetadas.

## Compatibilidade e backfill

`ReadOptimizationBackfillService` possui uma migração idempotente versionada em `system/read-optimization`.

Na primeira execução de um operador após esta versão:

1. verifica o marker;
2. lê somente as coleções que precisam dos novos campos derivados;
3. atualiza apenas documentos ainda não migrados;
4. grava o marker somente depois de concluir.

Se houver interrupção, uma execução posterior continua de forma segura. Enquanto o backfill não estiver completo, o Dashboard possui fallback de compatibilidade para preservar os resultados antigos.

Novas importações legadas já calculam os mesmos campos durante a normalização, evitando depender do backfill.

## Sincronização entre usuários

`system/data-revisions` contém stamps por domínio. Referências estruturais (coleções, fragrâncias, formatos, preços e unidades) usam um domínio separado de catálogo/estoque para que uma venda não provoque releitura desses cadastros estáveis. Cada mutation atualiza o documento dentro da mesma batch/transaction que altera os dados.

Existe apenas um listener compartilhado no cliente. Alterações feitas pela própria sessão não provocam reload dos feature stores: o estado local já foi atualizado pelo resultado da mutation. O mesmo stamp também marca caches derivados, como o Dashboard, como stale para que uma futura visita não exiba métricas antigas. Alterações de outra sessão invalidam os stores relevantes e só atualizam imediatamente os que estiverem sendo consumidos por uma tela ativa.

O perfil autenticado usa um listener dedicado em `users/{uid}`, substituindo leituras repetidas do perfil em guards e mantendo role/active atualizados.

## Manutenção

Ao adicionar uma nova funcionalidade:

1. prefira queries limitadas ou agregações;
2. evite buscar uma coleção inteira para calcular um número;
3. retorne da mutation os documentos/valores necessários para atualizar o estado local;
4. se criar um campo derivado, atualize-o atomicamente com sua origem;
5. adicione índice e teste correspondente;
6. não introduza `.load(true)` em páginas ou componentes.

Os testes de arquitetura bloqueiam regressões óbvias desse padrão.
