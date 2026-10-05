# Desenvolvimento local

Use Node 22.22.3 ou superior compatível com `package.json`.

```powershell
npm ci
npm test
npm run test:migration
npm run build:dev
npm start
```

Abra `http://localhost:4200`. DEV real usa `bem-feito-dev`. Google Authentication está habilitado e localhost autorizado. O acesso exige `users/{UID}` com `active: true`.

## Imagens com Google Drive

Firebase Storage não é utilizado pela integração de imagens. Configure os valores públicos de `environment.googleDrive`, habilite a integração e siga [google-drive-images.md](google-drive-images.md).

A pasta Drive permanece privada. Cada pessoa precisa:

- ser um usuário ativo do Bem Feito;
- usar a mesma conta Google no Firebase e no Drive;
- ter a pasta compartilhada com sua conta;
- conceder `drive.file` ao app.

Tokens OAuth ficam somente em memória.

## Emuladores

Java precisa estar disponível para o Firestore Emulator.

```powershell
npm run test:rules
npm run test:transactions
```

Os testes usam exclusivamente `demo-bem-feito`. Nunca aponte testes de Rules para PROD.

Para testes manuais:

```powershell
npm run firebase:emulators -- --project demo-bem-feito
```

Configure temporariamente `useEmulators: true` e `firebase.projectId: 'demo-bem-feito'` no environment de desenvolvimento. Emulator UI: `http://localhost:4000`; Auth: 9099; Firestore: 8080.

O Google Drive não é emulado pelo Firebase. Os testes unitários não usam credenciais reais; o teste de integração com Drive deve ser feito manualmente no DEV com contas e pasta de teste.

Restaure o environment real ao terminar. Não publique build com emuladores ativados.

## Builds e deploy

```powershell
npm run security:scan
npm test
npm run test:rules
npm run build:dev:hosting
npm run firebase:deploy:dev
```

O deploy DEV publica Firestore e Hosting. A configuração Drive usada no build vem do `environment.ts`.

Build PROD com placeholders verifica apenas compilação; não torna PROD publicável.

Não versione tokens, chaves privadas, credenciais administrativas, `.env` com secrets ou dados empresariais.
