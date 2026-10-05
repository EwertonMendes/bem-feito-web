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
npm install
npm start
```

O frontend abre em:

```text
http://localhost:4200
```

O `npm install` cria/atualiza o `package-lock.json` localmente. Depois que instalarmos as dependências pela primeira vez em uma máquina com acesso ao npm registry, esse lockfile deve ser versionado.

## Firebase DEV e PROD

O projeto foi preparado para dois projetos Firebase totalmente separados.

Preencha:

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
npm run build:dev
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

Arquivos com dados reais da planilha ficam ignorados pelo Git.

## Regra importante de operação

Vendas confirmadas não são editadas destrutivamente. Para corrigir uma venda, cancele a venda e registre outra. O cancelamento reverte estoque e pagamentos e mantém o histórico.
