# Arquitetura

A UI consome stores de feature. Stores chamam repositories. Repositories encapsulam Firestore.

```text
pages/ui
  -> feature stores
    -> repositories
      -> Firebase SDK
```

Valores monetários são persistidos em centavos inteiros. Datas comerciais usam `YYYY-MM-DD`; timestamps de auditoria usam `serverTimestamp()`.

Estoque possui saldo materializado em `products.stock` e `inputs.stock` e histórico em `stockMovements`. Operações que mexem em mais de uma entidade usam Firestore Transactions.

## Imagens

A UI não conhece Google Drive diretamente:

```text
Catalog/Sales UI
  -> ImageService
    -> ImageStoragePort
      -> GoogleDriveImageStorageService
        -> DriveApiService
```

`ImageProcessorService` cuida de validação, resize e WebP. `DriveAuthService` cuida somente do token OAuth em memória. `DriveIntegrationService` cuida da pasta configurada, conta Google e estado da integração.

Firestore armazena somente `CatalogImageRef`; o blob fica no Drive. Essa separação permite trocar o provider de armazenamento sem reescrever as telas ou o domínio de vendas.

Não existe transação distribuída entre Firestore e Drive. A integração usa operações idempotentes e compensação segura: criação pode deixar o cadastro sem imagem se o upload falhar; remoção limpa a referência antes de mandar o arquivo para a lixeira; substituição preserva o mesmo `fileId`.

Vendas guardam snapshots de nome, preço e custo para não alterar o histórico quando o catálogo mudar.
