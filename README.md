# Bem Feito Web

Aplicação Angular da Bem Feito para vendas, produção, estoque, financeiro, catálogo e configurações. O projeto substitui gradualmente a planilha/Apps Script e usa Firebase como backend.

## Stack

- Angular 22 standalone
- Signals e Signal Forms
- Change detection zoneless
- Firebase Authentication
- Cloud Firestore
- Firebase Hosting
- Google Drive privado para imagens do catálogo
- Vitest

## Estrutura

```text
src/
  app/
    core/          # Firebase, auth, Google Drive, repositories, services e utilitários
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

O frontend abre em `http://localhost:4200`. O `package-lock.json` está versionado; use `npm ci`.

## DEV

O Firebase DEV usa `bem-feito-dev`, com Authentication, Firestore e Hosting. O ambiente publicado continua em https://bem-feito-dev.web.app.

Firebase Storage não é necessário para a nova arquitetura de imagens. A integração Google Drive fica desativada enquanto `environment.googleDrive.enabled` for `false`; antes de testar imagens, configure os identificadores públicos do OAuth/Picker e siga [docs/google-drive-images.md](docs/google-drive-images.md).

PROD ainda não foi criado. Não reutilize configuração, pasta ou OAuth do DEV em PROD.

Consulte também [docs/firebase-setup.md](docs/firebase-setup.md).

## Comandos principais

```bash
npm run security:scan
npm test
npm run test:rules
npm run test:transactions
npm run test:migration
npm run build:dev
npm run build:dev:hosting
npm run build:prod
npm start
npm run firebase:emulators
npm run firebase:deploy:dev
npm run firebase:deploy:prod
```

## Segurança

Não versione service accounts, chaves privadas, OAuth client secrets, access tokens, refresh tokens, cookies de sessão ou App Check debug tokens.

Firebase Web config, OAuth Client ID e a Picker API Key de uma SPA são públicos por natureza. Mesmo assim, as chaves públicas devem ser restritas aos origins/APIs esperados. Execute `npm run security:scan` antes de enviar alterações.

## Migração

A migração real de DEV já foi concluída. Arquivos com dados reais e checkpoints continuam ignorados pelo Git.

## Regra importante de operação

Vendas confirmadas não são editadas destrutivamente. Para corrigir uma venda, cancele a venda e registre outra. O cancelamento reverte estoque e pagamentos e mantém o histórico.
