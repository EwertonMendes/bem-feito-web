# Arquitetura

O projeto usa dependências direcionais para manter UI, domínio e infraestrutura desacoplados.

```text
pages
  -> features
  -> shared

features
  -> core
  -> domain
  -> shared

core
  -> domain

shared/media
  -> core
  -> domain
  -> shared/ui

shared/ui
  -> Angular apenas

domain
  -> TypeScript puro
```

`pages/` coordena rotas e fluxos de tela. Componentes com comportamento específico de negócio ficam em `features/<feature>/components`. Componentes puramente visuais e reutilizáveis ficam em `shared/ui`. Adaptadores visuais que dependem da aplicação ficam em `shared/media`; feedback global fica em `shared/feedback`.

`tools/tests/architecture.test.mjs` valida essas fronteiras na CI. Uma nova dependência que inverta as camadas deve falhar antes do merge.

## Componentes

`BfDialog` encapsula abertura e fechamento do elemento nativo `dialog`. Páginas e componentes não manipulam mais `HTMLDialogElement` diretamente.

`BfImageFrame` é visual e não conhece storage, Firebase ou Google Drive. `CatalogImage` é o adaptador de mídia responsável por resolver um `CatalogImageRef` com `ImageService`, lazy loading e estado de carregamento.

Integrações específicas, como o banner e a configuração do Google Drive, ficam em `features/google-drive/components`, não em `shared/ui`.

Fluxos grandes são componentes da própria feature. O editor de catálogo vive em `features/catalog/components/catalog-editor` e o editor de venda em `features/sales/components/sale-editor`. As pages ficam responsáveis por navegação, filtros e coordenação de alto nível.

## Estado

`CatalogStore` mantém produtos, insumos, kits e adicionais. Dados administrativos usados como referência foram separados em `CatalogReferenceStore`: coleções, fragrâncias, formatos, preços por formato e unidades. Isso evita recarregar todas as referências quando apenas uma entidade operacional muda.

Stores chamam repositories. Repositories encapsulam persistência e transações.

```text
page/component
  -> feature store
    -> repository
      -> Firebase SDK
```

Valores monetários são persistidos em centavos inteiros. Datas comerciais usam `YYYY-MM-DD`; timestamps de auditoria usam `serverTimestamp()`.

Estoque possui saldo materializado em `products.stock` e `inputs.stock` e histórico em `stockMovements`. Operações que mexem em mais de uma entidade usam Firestore Transactions.

## Regras de negócio puras

Cálculos e validações que não precisam de I/O ficam fora dos repositories. A resolução das linhas de uma venda, composição de kits, custos, efeitos de estoque e desconto fica em `domain/logic/sale-resolution.ts` e possui testes unitários. `SalesRepository` continua responsável por leitura dos snapshots e pela atomicidade da Firestore Transaction.

Essa separação permite testar regras sem Firebase e evita que repositories virem serviços monolíticos.

## Imagens

A UI não conhece Google Drive diretamente:

```text
Catalog/Sales UI
  -> CatalogImage
    -> ImageService
      -> ImageStoragePort
        -> GoogleDriveImageStorageService
          -> DriveApiService
```

`ImageProcessorService` cuida de validação, resize e WebP. `DriveAuthService` mantém o access token curto em memória e em `sessionStorage` durante a sessão da aba para sobreviver a recarregamentos. `DriveIntegrationService` cuida da pasta configurada, conta Google e estado da integração.

Firestore armazena somente `CatalogImageRef`; o blob fica no Drive. Essa separação permite trocar o provider de armazenamento sem reescrever as telas ou o domínio de vendas.

Não existe transação distribuída entre Firestore e Drive. A integração usa operações idempotentes e compensação segura: criação pode deixar o cadastro sem imagem se o upload falhar; remoção limpa a referência antes de mandar o arquivo para a lixeira; substituição preserva o mesmo `fileId`.

Vendas guardam snapshots de nome, preço e custo para não alterar o histórico quando o catálogo mudar.
