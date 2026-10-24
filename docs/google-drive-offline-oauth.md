# Google Drive OAuth offline — Bem Feito

## DEV provisionado (24/10/2026)

- Firebase: `bem-feito-dev`; frontend: `https://bem-feito-dev.web.app`.
- Worker: `bem-feito-drive-dev`; URL: `https://bem-feito-drive-dev.ewertonmendes9.workers.dev`.
- D1: `bem-feito-drive-dev` (`baf5dfa3-b9e6-4749-8f64-0cdcf4f482da`).
- OAuth Web (server): `312978463343-9i9096fr0ccdnbono33mcob32mqdgdlv.apps.googleusercontent.com`.
- Secrets do Worker configurados no Cloudflare: `GOOGLE_CLIENT_SECRET` e `TOKEN_KEYS`. Nunca salvá-los no Git.
- Deploy: GitHub Environment `dev`, `CLOUDFLARE_API_TOKEN` (escopo Worker) e `CLOUDFLARE_ACCOUNT_ID`.
- A autorização OAuth está em *In production*. Isto não altera o estágio DEV da aplicação.

## Segurança

Firebase autentica o operador. O Worker verifica criptograficamente o ID token
Firebase, exige provider Google e valida o documento `users/{uid}` pelo REST
do Firestore com as Security Rules atuais. O retorno do Google OAuth exige ID token
válido, nonce, conta Google `sub` correspondente ao Firebase e e-mail verificado.

O Worker armazena refresh tokens e access tokens AES-256-GCM em D1.
Os tokens não aparecem em URL, Firestore, localStorage, IndexedDB ou logs.
O browser mantém somente o access token curto em memória para operações Drive e
Picker existentes. Ele pode receber o token após autenticação, portanto usuários
com permissão física de Editor no Drive ainda podem fazer operações Drive fora
da interface; as permissões no Google Drive continuam sendo a barreira de acesso.

OAuth PKCE utiliza state/launch-ticket de uso único, cookie HttpOnly/Secure
criado em navegação de primeiro nível e callback com verificação do navegador.
Uma autorização expirada não gera retorno de tokens de refresh ao navegador.

O Worker não faz proxy dos arquivos: imagens e metadados continuam no Drive,
com referências e subpastas mantidas no Firestore.

## Publicação e migrações

**Ordem obrigatória:**

1. Aplicar migrations em `worker/migrations` no D1 remoto DEV **antes**
   de ativar OAuth. Não executar em PROD nem em banco de preview compartilhado.
2. Validar as tabelas `oauth_transactions` e `drive_connections`.
3. Validar no Cloudflare os secrets `TOKEN_KEYS` e `GOOGLE_CLIENT_SECRET`.
4. Configurar `OAUTH_ENABLED=true` somente após migrations e verificação.
5. Publicar o Worker utilizando `wrangler deploy --env dev --keep-vars`, com
   o token GitHub restrito ao Worker; não sobrescrever os secrets criptografados.
6. Executar `GET /health` e conexão real com owner, depois com Maria.
7. Publicar o Angular DEV com o Worker ativo, homologar permissões, Picker,
   downloads, upload, substituição, remoção e renovação de tokens.
8. Fazer merge somente após validação. PROD tem configuração própria pendente.

O token de GitHub Actions disponível não possui `D1 Edit`. Para migrations
remotas, usar o painel D1 da conta Cloudflare (SQL console) ou uma credencial
temporária de escopo autorizado. Não conceder D1 Edit permanente em toda a
conta por conveniência.

Com a autenticação nova, o acesso anterior `initTokenClient` deixa de ser
necessário; o usuário deve realizar uma primeira autorização no novo cliente
OAuth, sem precisar recriar as pastas.

### Validar localmente

```sh
npm ci
npx tsc -p worker/tsconfig.json
node --experimental-strip-types --test worker/tests/*.test.mjs
npm test
npm run build:dev:hosting
```

### Diagnóstico

- `reconnect_required`: refresh token revogado/inválido; autorizar novamente.
- `google_identity_mismatch`: Google retornou outra conta; usar o mesmo login do Firebase.
- `oauth_not_enabled`: backend ainda não ativado (ou infraestrutura em manutenção).
- `user_not_authorized`: perfil Firebase ausente/inativo.
- `refresh_busy`: renovação concorrente excedeu limite de espera.
- `google_temporarily_unavailable`: erro transitório upstream; não revogar concessão.
