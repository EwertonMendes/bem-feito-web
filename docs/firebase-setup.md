# Configuração Firebase

## Situação em 05/10/2026

- DEV: `bem-feito-dev`, Spark, publicado em https://bem-feito-dev.web.app.
- Firestore: Native/Standard em `southamerica-east1`.
- Google é o provedor de Authentication.
- Rules, índices, Hosting e migração real de DEV já foram configurados.
- Firebase Storage não é usado pela arquitetura atual de imagens e não requer billing.
- PROD ainda não existe; `environment.production.ts` contém placeholders.

## Deploy DEV

O config público do Web App está em `src/environments/environment.ts`. Nenhuma credencial administrativa deve entrar no frontend.

```powershell
npx firebase-tools login
npm run security:scan
npm test
npm run test:migration
npm run test:rules
npm run test:transactions
npm run firebase:deploy:dev
```

O deploy publica somente Firestore e Hosting.

## Novos usuários

1. A pessoa faz login Google no DEV.
2. Confira a conta e UID no Firebase Authentication.
3. Um administrador cria `users/{UID}` com `email`, `displayName`, `role` e `active`.
4. Somente `active === true` libera o aplicativo.
5. Para imagens privadas, compartilhe também a pasta Google Drive com a mesma conta.

| Role | Permissão |
| --- | --- |
| owner | Operações e administração de perfis/integração |
| operator | Operações; não altera configuração global do Drive |
| viewer | Leitura operacional |

## Firestore Rules

O repositório é a fonte de verdade. Não use regras abertas ou test mode.

As Rules validam schema, auditoria, roles, valores operacionais e agora a referência de imagem Google Drive. O documento `integrations/google-drive` pode ser lido por usuários ativos e alterado somente por `owner`.

`npm run test:rules` usa somente o Firestore Emulator e inclui os testes específicos da integração Google Drive.

## Imagens

A configuração da API Google Drive/Picker é separada do Firebase. Veja [google-drive-images.md](google-drive-images.md).

O Firestore guarda somente `fileId` e metadados não secretos. Access token e refresh token nunca devem ser persistidos.

## Migração DEV

A migração concluída não deve ser repetida para atualizar cadastros. Use o app para alterações posteriores. Os scripts de migração e arquivos privados permanecem conforme documentado em [migration-dev.md](migration-dev.md).

## Etapas futuras

App Check pode ser configurado posteriormente. PROD exige projeto Firebase separado, config real, alias próprio, OAuth/Picker próprios, pasta Drive separada e nova revisão funcional e de segurança.

## Secrets

Não versione service-account JSON, private keys, OAuth client secrets, access tokens, refresh tokens, cookies, App Check debug tokens ou dados reais da migração. Firebase Browser API Key, OAuth Client ID e Picker API Key são configurações públicas de uma SPA, mas devem ser restringidas corretamente.
