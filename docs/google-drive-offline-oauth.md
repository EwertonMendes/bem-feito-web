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

**Situação em 24/10/2026:** migration D1 aplicada e conferida, OAuth ativado no painel Cloudflare pela configuração de produção do OAuth Google (ambiente aplicativo permanece DEV), `OAUTH_ENABLED=true` versionado no Wrangler; Worker com `/health` 200, rota protegida retornando 401 sem autenticação e CORS validado pelo provisionamento. O Angular do PR #77 foi publicado em Firebase DEV por `/deploy-dev-preview`, com commit verificado. Ainda é necessária homologação do consentimento real com owner e Maria, acesso aos arquivos existentes e refresh. Não realizar merge até validar o OAuth ponta a ponta.

**Estado e validação pós-publicação:**

1. D1 `bem-feito-drive-dev` possui as tabelas `oauth_transactions` e `drive_connections`, aplicadas manualmente no SQL Console e confirmadas pelo Codex.
2. Worker DEV já recebeu `OAUTH_ENABLED=true` no painel Cloudflare. A mesma configuração foi registrada em `worker/wrangler.jsonc`. Os secrets `GOOGLE_CLIENT_SECRET` e `TOKEN_KEYS` foram preservados.
3. O workflow `Deploy Drive Worker DEV` utiliza `wrangler versions upload --env dev` e `wrangler versions deploy --env dev`, com token de escopo `Individual Workers Editor`; variáveis públicas são integralmente gerenciadas pelo Wrangler. Secrets permanecem preservados no Cloudflare entre deployments, conforme documentação oficial, sem `--keep-vars`.
4. Frontend Angular DEV foi publicado pelo workflow de preview do PR #77. O commit publicado é verificado pelo GitHub.
5. **Homologação pendente:** cada conta (owner e Maria) deve concluir uma autorização inicial do cliente OAuth novo. Verificar leitura das pastas e arquivos atuais, renovação do token após expiração, upload, substituição, lixeira e desconexão. O procedimento de consentimento real depende da conta Google autenticada no navegador; não automatizar com credenciais compartilhadas.
6. Somente depois da homologação promover o PR. PROD permanece isolado e desativado.

O token GitHub existente **não** concede `D1 Edit`. A migration já foi aplicada manualmente. Por segurança não
habilitar um endpoint público de migrations no Worker nem ampliar o token
permanente sobre todos os bancos da conta (que também contém o Roteiva).
A migração é uma intervenção única no D1 DEV via painel ou credencial
temporária aprovada.

PROD ainda não possui projeto/host/Worker/banco/senha específicos e
continua desativado; nunca apontá-lo ao D1 DEV.

Com o novo cliente OAuth é esperada a autorização uma única vez de cada
conta Google. As imagens e subpastas pré-existentes permanecem no mesmo Drive.
O acesso efetivo precisa ser homologado antes do deploy do frontend.


## Diagnóstico Firebase JWT (DEV)

Em 24/10, a integração inicialmente apresentou `401 invalid_identity` e,
após detalhar a verificação, `503 identity_keys_unavailable`: o Worker
precisava resolver um redirecionamento HTTP antes de ler as chaves públicas
do serviço Firebase. A consulta JWKS passou a permitir redirecionamentos
HTTPS gerenciados pelo Google, conservando a verificação RS256, `kid`,
assinatura e claims. Um smoke test remoto confirmou HTTP 200 e um conjunto
não vazio de chaves públicas consultado **de dentro do Worker**.

O endpoint DEV `GET /health/identity-keys` é apenas diagnóstico e devolve
estado e quantidade de chaves; não divulga chaves, contas ou tokens.
O pipeline `Deploy Drive Worker DEV` o verifica após cada publicação e
falha caso a descoberta de chaves esteja indisponível. Esse endpoint não
é ativado em PROD.

Esta correção confirma a disponibilidade das chaves públicas, mas não
substitui o teste OAuth de ponta a ponta com uma conta Firebase real,
as verificações Firestore, a seleção da pasta e o refresh de concessões.


### Perfil Firestore no Worker

Após a descoberta das chaves Firebase ser corrigida, a próxima falha observada
na tela DEV foi `HTTP 503 user_profile_unavailable`. A rota REST que lê o
documento `users/{uid}` utilizava `redirect:'error'`, impedindo o Worker
de seguir um redirecionamento da API do Google. O código agora utiliza
`redirect:'follow'`, mantendo a própria credencial Firebase ID token do
usuário — **não** introduz uma conta de serviço que ignore Firestore Rules.

A checagem continua exigindo perfil ativo, papel válido e e-mail do perfil
coincidente com o e-mail verificado no token. Respostas `401/403/404` do
Firestore continuam sendo tratadas como negação de acesso; falhas
transitórias e respostas inesperadas recebem códigos de diagnóstico
sanitizados, sem dados da conta ou do token.

Testes verificam a consulta com Bearer ID token, a política de redirecionamentos,
a rejeição de usuários inativos, e-mails divergentes, negação de acesso,
e a diferenciação de erros de transporte, upstream e JSON inválido.
O deploy do Worker passou após essa correção; a autenticação real no
navegador ainda precisa ser homologada antes do merge.

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
