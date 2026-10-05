# Arquitetura

A UI consome stores de feature. Stores chamam repositories. Repositories encapsulam Firebase.

```text
pages/ui
  -> feature stores
    -> repositories
      -> Firebase SDK
```

Valores monetários são persistidos em centavos inteiros.

Datas comerciais usam `YYYY-MM-DD`. Timestamps de auditoria usam `serverTimestamp()`.

Estoque possui saldo materializado em `products.stock` e `inputs.stock` e histórico em `stockMovements`.

Operações que mexem em mais de uma entidade usam Firestore Transactions: vendas, cancelamentos, produção, compras de insumos, recebimentos e ajustes de estoque.

Vendas guardam snapshots de nome, preço e custo para não alterar o histórico quando o catálogo mudar.
