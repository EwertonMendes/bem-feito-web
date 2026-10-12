# Bem Feito Web 1.0 — guia de homologação e virada

## Escopo entregue para homologação DEV
- Caixa e Dashboard com conferência de saldo (a última conferência tem precedência sobre o saldo importado).
- Origem genérica do pagamento de despesas; aporte e empréstimo não entram no faturamento.
- Encomendas: saldo por linha, alocação explícita de estoque físico por cliente, transições e cancelamento transacionais. Produção mantém reservas legadas isoladas, com contador de compromissos explícitos opcional (ausente = zero em documentos anteriores).
- Correções auditadas de cliente/vencimento/notas e de quantidade/preço de linhas existentes; pagamentos aplicados, CMV histórico e reservas são protegidos.
- Histórico de vendas indexado por código e cliente normalizado. Backfill versão 2 transforma a chave derivada a partir do nome, sem alterar preços, recebimentos nem estoque.
- Exportação CSV paginada em Vendas/Financeiro (Saídas, Recebimentos, A Receber, Movimentações) e exportação de estoque físico, reservado e livre.
- Comparador de snapshots em `tools/reconciliation/compare-snapshots.mjs`; não realiza gravações.

## Invariantes e compatibilidade
1. `products.committedStock` representa TODOS os pedidos em aberto.
2. `products.explicitCommittedStock` representa a parcela dos compromissos criada no novo fluxo por item; quando ausente, usar zero.
3. `products.explicitAllocatedStock` representa a parcela fisicamente reservada para linhas identificadas; quando ausente, usar zero.
4. `products.reservedPhysicalStock` mantém o total físico (legado + explícito), sem exceder `stock`.
5. Para produto, `0 ≤ explicitAllocatedStock ≤ explicitCommittedStock ≤ committedStock` e `explicitAllocatedStock ≤ reservedPhysicalStock ≤ stock`.
6. Produção e correções automáticas só alocam o que ainda falta aos **pedidos legados**; novos pedidos usam ação explícita de alocação. Não pressupor vínculo de produção antiga.
7. Vendas legadas sem `orderAllocations` não recebem quantidades fabricadas inventadas; a interface sinaliza conciliação.
8. Quantidades/preços de linhas não são alterados por correção se consumirem estoque alheio ou tornarem o total menor que o já recebido.

## Testes manuais no DEV (conta operacional autorizada)
1. Financeiro: confirmar saldo fictício **somente em DEV** e verificar número/data no Dashboard; registrar e estornar um aporte de teste.
2. Catálogo/Estoque: conferir saldos físico/reservado/livre de sabonetes e insumos.
3. Nova Venda: criar pedido de teste com dois sabonetes em produção, incluindo preço personalizado de uma linha; verificar compromisso sem baixa física.
4. Produzir quantidade parcial; voltar à Venda, reservar explicitamente unidades para a linha; confirmar progresso correto. Tentar exceder o estoque livre (deve recusar).
5. Alocar o restante, marcar pronta e entregue; conferir um único débito físico e liberação das reservas.
6. Corrigir nome, vencimento e notas de venda (motivo obrigatório), conferir auditoria. Corrigir quantidade/preço de uma venda de teste, conferir impacto previsto, CMV histórico e saldo.
7. Tentar reduzir venda abaixo dos pagamentos recebidos; deve recusar sem alterar nada. Tentar consumir estoque reservado; deve recusar.
8. Usar Busca histórica por código `V00024` e cliente com acentos; a migração da chave precisa estar concluída.
9. Exportar CSV de todas as abas Financeiro, Vendas e Estoque; abrir em Excel ou Sheets e comparar centavos.
10. Testar com duas sessões, celular/desktop, tema claro/escuro, e verificar sem duplicações em operações concorrentes.

## Conciliação e migração de dados (GATE, não automática)
- Snapshot da planilha oficial e snapshot do Firestore DEV de forma consistente; garantir IDs estáveis, documentar correspondências, conferir registros da entrega de Juan (11/10/2026), equipamentos, insumos, pagamentos, estornos, receitas, saldos e estoque físico.
- Comparar documentos com `node tools/reconciliation/compare-snapshots.mjs origem.json dev.json relatorio.json`. O comparador apenas verifica divergências de IDs e campos, não inventa correspondências nem importa.
- Qualquer divergência crítica exige relatório com origem, decisão e revisão antes de gravar.
- Antes de mudar dados existentes, capturar backup fora do projeto Firestore de trabalho com integridade SHA-256 e confirmação de que pode ser restaurado; executar preview/revisão/aplicação pelo gateway de administração protegido e verificar leitura posterior.
- Não migrar ou reconstruir unidades já produzidas de pedidos históricos sem comprovação.

## PROD (GATE obrigatório de configuração)
- `environment.production.ts` permanece com valores `REPLACE_PROD_*`; PROD não deve ser publicado usando credenciais do DEV.
- Criar projeto Firebase PROD **separado**, configurar Auth/domínios autorizados, Firestore Rules/indexes, Hosting, OAuth/Drive, usuários reais, projeto de cobrança/cotas e alertas.
- Implantar rotina de backup **integral e recorrente** em destino independente, com retenção, validação de checksums, falha alertada e *restore* real testado. Snapshot operacional de data-admin não é backup integral.
- Pipeline PROD precisa exigir CI verde, SHA imutável, aprovação humana, migração idempotente e verificação pós-deploy.
- Datas e horário de corte: primeiro conciliar, depois bloquear dupla escrituração, importar estado final, conferir KPIs e permitir produção.
- Sem credenciais/autorizações de PROD, encerrar em DEV para homologação; não inventar URLs/projetos, não executar merge nem corte automaticamente.

## Critério de pronto
CI e regras aprovados; no DEV operações de teste respeitam invariantes; comparação de dados não tem divergência crítica inexplicada; PROD provisionado e com backup/restauração ensaiados; aceite final explícito para migrar.
