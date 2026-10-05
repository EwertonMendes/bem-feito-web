# Bem Feito Web

Aplicação Angular da Bem Feito para vendas, produção, estoque, financeiro, catálogo e configurações. O projeto substitui gradualmente a planilha/Apps Script e usa Firebase como backend.

## Stack

- Angular 22 standalone
- Signals e Signal Forms
- Change detection zoneless
- Firebase Authentication
- Cloud Firestore
- Cloud Storage
- Firebase Hosting
- Vitest

## Estrutura

```text
src/
  app/
    core/          # Firebase, auth, repositories, services e utilitários
    domain/        # Models do domínio
    features/      # Stores por feature
    layout/        # Shell desktop/mobile
    pages/         # Telas Angular
    shared/        # Componentes visuais reutilizáveis
  environments/   # DEV e PROD
  main.ts
  styles.scss
public/
tools/
  admin/
  migration/
  tests/
```

## Requisitos locais

Use Node 22.22.3 ou superior. Se tiver nvm:

```bash
nvm use
```

Depois:

```bash
npm ci
npm start
```

O frontend abre em:

```text
http://localhost:4200
```

O `package-lock.json` está versionado. Use `npm ci` para instalar as versões reproduzíveis.

## Firebase DEV e PROD

DEV usa o projeto `bem-feito-dev`, com Google Authentication e Firestore Native/Standard em `southamerica-east1` (São Paulo). O primeiro owner e uma gravação real pelo navegador foram validados em 05/10/2026.

DEV está publicado em https://bem-feito-dev.web.app. A migração real foi concluída e conferida em 05/10/2026: 282 registros de domínio e cópia de origem das 21 abas. Consulte [o relatório da migração](docs/migration-dev.md).

Por decisão do usuário, imagens e App Check ficam adiados. Os cadastros funcionam sem imagem e permitem edição posterior. Storage não foi criado e nenhum faturamento foi vinculado. PROD ainda não foi criado; a compilação com placeholders não significa um ambiente PROD funcional.

Configurações:

```text
src/environments/environment.ts
src/environments/environment.production.ts
.firebaserc
```

Consulte [docs/firebase-setup.md](docs/firebase-setup.md).

## Comandos principais

```bash
npm start
npm test
npm run test:rules
npm run test:transactions
npm run test:migration
npm run build:dev
npm run build:dev:hosting
npm run build:prod
npm run firebase:emulators
npm run firebase:deploy:dev
npm run firebase:deploy:prod
```

## Migração

```bash
npm run migration:normalize
npm run migration:validate
npm run migration:reconcile
npm run migration:import
```

Arquivos com dados reais da planilha e checkpoints ficam ignorados pelo Git. A importação é exclusiva de DEV, começa em dry-run, recusa colisões e grava o lote atomicamente. Consulte [as instruções Firebase](docs/firebase-setup.md) antes de executar; a migração já concluída não precisa ser repetida.

Não versione service accounts, chaves privadas, OAuth secrets, tokens de sessão ou App Check debug tokens. O Firebase Web config é público por natureza; Authentication e Rules controlam o acesso atual. App Check está adiado.

## Regra importante de operação

Vendas confirmadas não são editadas destrutivamente. Para corrigir uma venda, cancele a venda e registre outra. O cancelamento reverte estoque e pagamentos e mantém o histórico.
