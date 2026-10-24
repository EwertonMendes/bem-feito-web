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

**Situação em 24/10/2026:** Worker DEV foi publicado pelo workflow
`Deploy Drive Worker DEV` e seu `GET /health` validado. O backend permanece
deliberadamente com `OAUTH_ENABLED=false`. O banco remoto D1 ainda precisa
receber as tabelas antes de qualquer fluxo OAuth real. O Angular DEV ainda
usa o código anterior até o deploy preview do PR.

**Ordem obrigatória para liberar o fluxo real:**

1. Acessar o Cloudflare D1 **bem-feito-drive-dev** (ID
   `baf5dfa3-b9e6-4749-8f64-0cdcf4f482da`) → Console SQL; aplicar
   integralmente o SQL versionado em
   [worker/migrations/0001_drive_oauth.sql](../worker/migrations/0001_drive_oauth.sql).
   Confirmar que as tabelas `drive_connections` e `oauth_transactions`
   existem. Esse SQL contém `IF NOT EXISTS` para reexecução segura.
   Alternativamente, com uma credencial temporária **D1 Edit** autorizada,
   executar `npx wrangler@4.152.0 d1 migrations apply bem-feito-drive-dev --env dev --remote`
   dentro de `worker/`. Nunca colar tokens em chat ou versionar credenciais.
2. Confirmar no Worker os secrets criptografados `GOOGLE_CLIENT_SECRET` e
   `TOKEN_KEYS`. Não trocar suas chaves após a concessão de tokens.
3. Alterar `OAUTH_ENABLED` de `false` para `true` no arquivo
   `worker/wrangler.jsonc` da branch **somente depois do schema pronto**.
   Publicar a nova versão pelo workflow GitHub. A variável no arquivo é a
   configuração durável; alterar apenas a variável no painel não é suficiente,
   pois o próximo deploy pode sobrescrever o valor.
4. Usar o workflow `Deploy Drive Worker DEV`, que publica via
   `wrangler versions upload --env dev --keep-vars` e
   `wrangler versions deploy --env dev`. O token de deploy está
   propositalmente restrito a **Individual Workers Editor**. O comando
   `wrangler deploy` tradicional **não** funciona com esse token porque
   exige acesso adicional à configuração do subdomínio `workers.dev`.
5. Conectar um owner real ao novo OAuth, validar sua identidade e confirmar a
   leitura da pasta principal e das quatro subpastas já existentes. Depois
   autorizar e testar também a conta de Maria. Nenhuma pasta precisa ser
   recriada ou migrada.
6. Somente então publicar o Angular DEV através do fluxo de preview do
   próprio PR; validar login, carregamento de imagens, Picker, downloads,
   upload, atualização com o mesmo `fileId`, exclusão, revogação e
   refresh após expiração.
7. Confirmar que nenhum token foi persistido no navegador, que a conexão
   realmente se restaura após fechar/reabrir o aplicativo e que não há
   chamados recorrentes de consentimento. **Não fazer merge antes de homologar**.

O token GitHub existente **não** concede `D1 Edit`. Por segurança não
habilitar um endpoint público de migrations no Worker nem ampliar o token
permanente sobre todos os bancos da conta (que também contém o Roteiva).
A migração é uma intervenção única no D1 DEV via painel ou credencial
temporária aprovada.

PROD ainda não possui projeto/host/Worker/banco/senha específicos e
continua desativado; nunca apontá-lo ao D1 DEV.

Com o novo cliente OAuth é esperada a autorização uma única vez de cada
conta Google. As imagens e subpastas pré-existentes permanecem no mesmo Drive.
O acesso efetivo precisa ser homologado antes do deploy do frontend.

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
