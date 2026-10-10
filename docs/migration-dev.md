# Migração real — DEV

Concluída em 05/10/2026 no projeto `bem-feito-dev`, execução `45c4e04f3e496303c0ebcd46`. Aplicativo publicado em https://bem-feito-dev.web.app. A planilha original foi somente lida, sem alterações.

## Cobertura

As 21 abas, incluindo as ocultas, foram lidas. Foram importados 282 registros de domínio, além da cópia de origem das 21 abas e metadados. Linhas vazias com IDs ou fórmulas pré-preenchidos foram preservadas na origem, sem virar registros fictícios.

| Coleção | Registros |
| --- | ---: |
| Coleções | 2 |
| Fragrâncias | 11 |
| Formatos | 6 |
| Preços de formato | 12 |
| Unidades | 5 |
| Meios de pagamento | 3 |
| Categorias de despesa | 7 |
| Tipos de despesa | 4 |
| Insumos | 21 |
| Produtos | 52 |
| Kits | 10 |
| Adicionais | 2 |
| Compras e despesas | 8 |
| Produções | 23 |
| Vendas | 18 |
| Recebimentos | 17 |
| Ajustes de estoque | 5 |
| Movimentos de estoque | 71 |
| Contadores | 5 |
| **Total** | **282** |

Não havia receitas preenchidas na origem. Itens de venda, componentes de kit/adicional e efeitos de estoque foram preservados nos documentos correspondentes. Recebimento já estornado continua estornado, sem entrar novamente nos totais.

## Integridade e recuperação

O lote inicial de 312 gravações foi atômico: dados reais, cópia de origem, inativação de sete testes ainda ativos e marcador de conclusão. Não houve sobrescrita de IDs existentes nem alteração do perfil owner. Os nove cadastros descartáveis da configuração foram posteriormente arquivados com cópia completa recuperável e removidos do catálogo operacional.

O readback conferiu os campos dos 282 registros e as 21 abas arquivadas. A validação encontrou zero erros impeditivos. Relacionamentos, valores monetários, datas, recebimentos e soma histórica dos movimentos versus estoque de origem foram conferidos. Arquivos de dados, checkpoint, recibo e readback são privados e ignorados pelo Git.

Datas numéricas do Sheets foram convertidas como dias de calendário. Valores monetários do domínio usam centavos inteiros. Precisão original dos custos unitários e valores calculados fica preservada na cópia de origem. Custos ausentes permanecem pendentes; não foram inventados.

## Reconciliação

Período de 02/09/2026 a 01/10/2026, conferido com indicadores e fórmulas da planilha e Dashboard publicado:

| Indicador | Resultado |
| --- | ---: |
| Faturamento | R$ 451,00 |
| Recebido | R$ 393,00 |
| Saldo a receber | R$ 48,00 |
| Vendas válidas | 15 |
| Ticket médio | R$ 30,07 |
| Gorjetas | R$ 4,00 |
| CMV conhecido | R$ 11,00 |
| Saídas de caixa | R$ 329,42 |
| Fluxo de caixa | R$ 67,58 |
| Itens vendidos sem custo conhecido | 35 |
| Produtos com estoque negativo | 11 |
| Produtos em estoque baixo | 50 |
| Insumos em estoque baixo | 0 |

O aplicativo mostra 37 itens físicos vendidos. O indicador da planilha mostra 49 porque também soma cabeçalhos de kits/adicionais junto aos componentes. Os 37 foram conferidos pelas quantidades dos produtos e componentes; essa diferença de definição não representa perda de itens ou valores.

## Pendências da origem

A validação preservou 61 alertas: 11 produtos com estoque negativo, 37 produtos sem custo e 13 insumos sem custo. No período reconciliado, 35 itens vendidos têm custo pendente; o resultado estimado continua indicado como incompleto. Insumos com estoque mínimo vazio mantêm essa configuração ausente e não recebem limite artificial.

A origem também contém datas posteriores a 05/10/2026: três vendas e cinco recebimentos (quatro ativos e um já estornado). Datas e estados foram preservados; esses lançamentos não entram nos indicadores do período reconciliado encerrado em 01/10/2026. É necessário confirmar com a empresa se as datas futuras são intencionais antes de corrigir qualquer registro.

Essas pendências devem ser corrigidas com informação empresarial confirmada, através dos cadastros e ajustes do aplicativo. Nenhuma correção foi fabricada na migração. Na ausência de receitas históricas, custos de produção permanecem pendentes. O normalizador genérico usa a receita atual quando disponível; para futuras migrações, isso exige revisão se a receita histórica era diferente.

## Validação técnica

- 15 testes unitários e 2 testes do pipeline de migração.
- 145 verificações de Rules Firestore e 17 Storage nos emuladores.
- 10 testes de transações dos repositories, incluindo rollback e cancelamento idempotente.
- Builds DEV, DEV Hosting e PROD compilados; PROD permanece com placeholders e sem projeto publicado.
- Login, sessão, cadastro sem imagem e leitura de dados reais verificados no navegador interno.

Imagens e App Check permanecem adiados conforme solicitado. Nenhum billing foi vinculado. A revisão de invariantes profundas nas Rules continua necessária antes de PROD; ver [firebase-setup.md](firebase-setup.md).
