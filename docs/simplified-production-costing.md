# Custeio simplificado da Bem Feito

## Objetivo

Separar claramente **caixa (compra integral)**, **margem gerencial estimada (custo incorporado a cada produto)** e **estoque físico de produtos acabados/embalagens**. O preço de aquisição de glicerina, lauril, corantes e essências não depende de contabilizar cada utilização.

## Modelo operacional

- Materiais de fabricação ficam em `inputs` com `trackingMode: untracked`. A compra em `expenses` permanece integral, com data, valor, forma/origem de pagamento e itens; ela atualiza somente `costBasisQuantity`, `costBasisValueCents`, `averageUnitCostCents`, sem incrementar estoque do material. O preço médio é independente do saldo físico anterior.
- Insumos físicos que de fato são contados, como embalagens consumidas por adicionais, continuam `exact` e são debitados somente ao vender.
- Cada material de fabricação pode integrar um `costPool`: `base` (g), `surfactant` (ml), `fragrance-classic` (ml), `fragrance-premium` (ml), `colorant` (ml). Produtos não são vinculados a um corante específico nem a uma essência fixa. Um material contado fisicamente nunca é utilizado como preço de um pool.
- Cada coleção escolhe explicitamente `fragranceCostPool`. Não inferir a partir do nome.
- Cada formato opta explicitamente por `soapCostProfile` com glicerina base (g), lauril (ml), essência (ml), corantes (ml) e custo complementar fixo em centavos. Sem esse perfil, o modelo anterior permanece ativo até a migração deliberada.
- A precificação do pool é **ponderada pelas quantidades adquiridas** se todos os materiais possuem dados de aquisição. A média dos custos unitários legados só é usada como fallback caso os dados completos de compra ainda não estejam disponíveis. Falta de informação deve ficar visível; nunca substituir por zero e chamar de lucro conhecido.

## Eventos

1. **Compra**: registra uma única saída financeira pelo valor total; o custo médio do material passa a incorporar o valor de aquisição, inclusive custos capitalizáveis. Não gera saldo para matérias-primas sem controle.
2. **Produção**: escolhe produtos/quantidades, grava custo por unidade, total e composição estimada por pool; não movimenta saldo dos materiais dos perfis. O estoque de produtos acabados aumenta normalmente. Se alguma referência de custo estiver ausente, o lançamento fica `costPending`, sem substituir o último custo de vendas conhecido.
3. **Venda**: usa o custo médio já incorporado ao estoque de produtos. Embalagens vinculadas a adicionais continuam sendo movimentadas; materiais sem saldo não.
4. **Relatórios**: o CMV representa estimativas incorporadas às vendas. Compras são saídas de caixa, mostradas separadamente; não devem ser somadas novamente como despesa de produção na fórmula de margem gerencial.

## Preparação e homologação em DEV

1. Registrar a referência de compra de cada material: **quantidade comprada na unidade base** e **valor total pago**, identificando compras existentes para não duplicar saídas.
2. Selecionar o pool de cada material e manter o modo **Não controlar saldo**. Transição de controle físico para não controlado guarda a data, o modo e o saldo histórico anterior, e bloqueia materiais com reservas ou vinculados a adicionais ativos.
3. Marcar a coleção Clássica como `fragrance-classic` e + Aroma como `fragrance-premium` (somente após validar os registros existentes).
4. Informar quantidades **médias**, não receita rígida, para cada formato: glicerina, lauril, essência e corante, e custo fixo se houver. Não presumir valores faltantes.
5. Verificar tela de produção/catálogo, um sabonete de cada coleção e formato, mistura de essências e corantes, adicionais com controle e uma venda sem adicionais.
6. Só então regularizar históricos de produção em migração versionada e auditada: comparar valores originais, preservar datas, produtos, quantidades e vendas; reprocessar snapshots de custo separadamente das movimentações de estoque e caixa. Sem reajustes automáticos em PROD.
7. Publicar PROD exclusivamente após validação de dados e aprovação explícita. Backup + conferência entre DEV/PROD antes de qualquer migração.

## Dados a solicitar ao negócio

- Para glicerina branca, lauril, essência Clássica, essência + Aroma e corantes: o(s) valor(es) total(is) das compras e a(s) quantidade(s) comprada(s) com unidade. Pode informar preços por embalagem em vez de custo por grama/ml.
- Quantidade média de cada material por sabonete (ou padrão percentual de uma batelada), separada por formato. Os formatos podem ter dosagens diferentes; não é obrigatório informar uma receita para cada fragrância.
- Custo complementar por unidade, se existir. Embalagens vendidas como adicionais precisam de preço de compra e unidade, sem alterar sua contagem física.

## Compatibilidade

Todos os campos novos são opcionais. Produções históricas ficam com snapshots inalterados até a recalibração aprovada; elas podem continuar com o aviso de custo parcial. A implantação do código não recalcula retroativamente valores, não apaga movimentações e não altera o caixa.

## Auditoria de referências existentes — 28/10/2026

Fonte consultada em leitura: planilha operacional "Bem Feito — Controle de Vendas, Estoque e Custos",
aba "Compras e Despesas", "Custos de Aquisição", "Ficha de Produção" e "Cadastros".
Estes são **dados históricos**, não substituem a verificação dos cadastros atuais do Firestore e não autorizam criar novas compras.

| Material | Compra / custo registrado | Normalização para referência de fabricação | Atenção |
| --- | --- | --- | --- |
| Glicerina branca | M000008 3 kg R$55,10 + frete CA-00004 R$13,99 = R$69,09 | R$23,03/kg com esse frete | M000011 3 kg R$58,00; M000018 4 kg R$89,07 tinha recebimento pendente na planilha |
| Glicerina transparente | M000007 4 kg R$77,90 | R$19,475/kg | Compra por kg, cálculo por grama |
| Lauril vegetal | M000006 1 frasco 500 ml R$16,80 | R$0,0336/ml | Outra embalagem de Mercado Livre referida nas observações, sem valor individual confirmado nesta linha |
| Essências Clássicas | M000002 4 frascos ×100 ml R$51,61 | R$0,129025/ml em média para esse kit | Não tratar como preço de todas as essências fora do kit |
| Essências Vollmens Premium | M000001 3 frascos ×30 g R$52,71 | R$0,585667/g para esse lote | **Gramas não são mililitros**; confirmar fator ou modelar dosagem em g. M000019 lote extra R$55,71 em trânsito na planilha |
| Corantes | M000010 5 frascos ×30 ml R$31,92 | R$0,2128/ml | Custo médio do kit, independente da cor |
| Saquinho organza | M000012 100 un. R$22,99 | R$0,2299/un. | Estoque físico permanece controlado |

Ficha de Produção registrada em 08/10/2026 (quantidade média por unidade; sequência `base g / essência ml / corante ml / lauril ml`):
- Mini Florzinhas: `3 / 1 / 1 / 1`.
- Patinha M: `35 / 1,5 / 1 / 1,5`.
- Patinha G: `55 / 1,5 / 1,5 / 1,5`.
- Barra Arredondada: `87 / 2,5 / 2 / 2`.
- Massageador: `120 / 3 / 2,5 / 2`.
- Mini Cubinhos: `9 / 0,2 / 0,2 / 0,2`.
- Floral: ficha antiga dizia **90 g**, mas a correção informada em 28/10/2026 é **75–80 g**. Usar 77,5 g como ponto médio de custo **após aprovação da referência**; as quantidades específicas da composição permanecem sem confirmação.
- Coraçõezinhos: 1,5 g por unidade, sem composição comprovada na ficha.

As fichas antigas são propostas de referência para homologação, **não valores novos validados**. Conservar divergências e documentar alterações de versão. Para produção em g/ml com compras em `kg`, `ml` ou `un`, o cadastro permite indicar `costUnitFactor` por item (por exemplo: 1 kg = 1000 g; 1 frasco de 500 ml = 500 ml), sem alterar lançamentos financeiros nem estoque. Não presumir equivalência g/ml para essências premium.
