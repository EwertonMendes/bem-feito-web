# Configuração Firebase

## Situação em 05/10/2026

- DEV: `bem-feito-dev`, Spark, publicado em https://bem-feito-dev.web.app.
- Web App: `Bem Feito Web DEV`, ID `1:312978463343:web:e49e223d872b9c68374b9a`.
- Firestore: `(default)`, Native/Standard, `southamerica-east1`, proteção contra exclusão habilitada.
- Google é o único provedor habilitado. Domínios autorizados: `localhost`, `bem-feito-dev.web.app`, `bem-feito-dev.firebaseapp.com`.
- Primeiro owner confirmado pelo login real. Acesso sem perfil, logout/login, refresh e gravação/edição sem imagem verificados no navegador.
- Rules, índices e Hosting publicados a partir do repositório. Migração real concluída e verificada; veja [migration-dev.md](migration-dev.md).
- Storage não criado e billing não vinculado. Imagens e App Check adiados por decisão do usuário; App Check sem provider registrado ou enforcement.
- PROD não existe nem tem alias. `environment.production.ts` contém placeholders e não deve ser publicado.

## Deploy DEV

O config oficial público do Web App está em `src/environments/environment.ts`. Nenhuma credencial administrativa deve entrar no frontend.

```powershell
npx firebase-tools login
npm test
npm run test:migration
npm run test:rules
npm run test:transactions
npm run firebase:deploy:dev
```

O deploy DEV compila com `dev-hosting`, usando o environment DEV, otimização e nomes de arquivos com hash, sem sourcemaps. Publica somente Firestore e Hosting. O diretório é `dist/bem-feito-web/browser`, com rewrite SPA e `Cache-Control: no-cache`. `build:dev` continua disponível para desenvolvimento local.

`catalogImagesEnabled: false` oculta upload e evita dependência de Storage. Os modelos preservam campos de imagem para edição futura. Escolha e implemente o armazenamento antes de mudar a flag. Se optar por Firebase Storage, autorize billing e crie o bucket antes de publicar suas regras.

## Novos usuários

1. A pessoa faz login Google no DEV uma vez.
2. No Console, Authentication → Usuários, confira a conta e seu UID.
3. Um administrador cria `users/{UID}` com `email`, `displayName`, `role` e `active` booleano.
4. Somente `active === true` libera acesso ao aplicativo.

| Role | Permissão |
| --- | --- |
| owner | Operações e administração de perfis |
| operator | Operações; não gerencia perfis |
| viewer | Leitura operacional |

Prefira o Console para bootstrap. O helper `tools/admin/upsert-user.mjs` exige credenciais administrativas; não baixe uma service account permanente.

## Rules e limites

O repositório é a fonte de verdade. Não use regras abertas ou test mode. Os testes usam exclusivamente `demo-bem-feito` nos emuladores.

As regras validam campos de primeiro nível, tipos, estados financeiros e valores monetários inteiros entre 0 e 1.000.000.000 centavos. Quantidades têm limite de 1.000.000. Counters só avançam, até 500 por gravação, preservando auditoria. O cliente não exclui documentos financeiros nem grava os arquivos da migração. Somente owner lê a cópia de origem.

Estoques negativos existentes na planilha foram preservados. Uma atualização pode mantê-los ou corrigi-los, mas não criar novo déficit nem agravar um existente. Insumos sem estoque mínimo configurado não geram alerta artificial.

Há 145 verificações Firestore e 17 Storage, além de 10 testes de transações dos repositories: venda, kit/adicional, recebimento/estorno/cancelamento, produção com insumos repetidos, compra, ajustes e rollback de operações negadas. Esses testes usam os emuladores, sem criar transações financeiras reais para teste.

Antes de PROD, ainda é necessário aprofundar validação das listas internas e vínculos entre documentos nas Rules: um operador com SDK pode tentar gravações isoladas que respeitem o schema. Atomicidade dos repositories não equivale a validação completa de invariantes pelo servidor.

Storage tem regras preparadas e testadas para `catalog/**`, perfil ativo, owner/operator, até 3 MB e WebP/PNG/JPEG/GIF/AVIF. Elas não foram publicadas em um bucket real. MIME declarado não é inspeção do conteúdo.

## Migração DEV

A migração concluída tem ID `45c4e04f3e496303c0ebcd46`. Não repita a importação para atualizar cadastros: use o app. O importador reconhece o mesmo digest como execução já concluída e recusa colisões com IDs existentes.

Os scripts `export-legacy.gs`, `normalize-legacy.mjs`, `validate-export.mjs`, `reconcile.mjs` e `import-firestore.mjs` compõem o fluxo. Nesta execução, a origem foi lida pelo conector Google Sheets, incluindo abas ocultas e fórmulas selecionadas para conferência.

```powershell
npm run migration:normalize
npm run migration:validate
npm run migration:reconcile -- tools/migration/migration-data.json 2026-09-02 2026-10-01 tools/migration/reconciliation.json
$env:FIREBASE_PROJECT_ID = 'bem-feito-dev'
node tools/migration/import-firestore.mjs --firebase-cli
# Somente após conferir o dry-run:
node tools/migration/import-firestore.mjs --firebase-cli --commit
npm run migration:verify
```

Na conclusão inicial, `npm run migration:verify -- --exact-counts` também conferiu ausência de registros extras nas coleções. Esse modo só é adequado antes de novas operações legítimas no app; a comparação com o checkpoint original deixa de ser uma verificação do estado atual depois de editar os dados.

`--firebase-cli` reutiliza a sessão interativa existente da Firebase CLI através de adaptador de autenticação; não exporta tokens nem cria chaves permanentes. O adaptador depende da API interna da versão instalada de `firebase-tools`. A alternativa ADC exige autenticação administrativa configurada previamente.

O importador valida antes de acessar credenciais, limita o lote a 450 gravações/8 MB, usa criação sem sobrescrita e grava dados, origem e marcador de conclusão atomicamente. Exportações, checkpoint anterior, recibo e readback ficam ignorados pelo Git em `tools/migration`. A API administrativa passa fora das Rules, portanto a validação própria é obrigatória.

`archive-dev-tests.mjs RUN_ID` mostra dry-run dos cadastros descartáveis do checkpoint. `--commit` arquiva cópia em `migrationSources/{RUN_ID}/devTestFixtures` e remove apenas originais inativos, sem mudanças posteriores e sem colisão com dados reais. Os nove cadastros desta configuração já foram arquivados e conferidos.

## Etapas futuras

App Check pode ser configurado posteriormente, com provider oficial e observação das métricas antes de enforcement. Tokens de debug nunca devem ser versionados.

PROD exige projeto separado, config real, alias próprio, owner controlado e nova revisão funcional e de segurança. Build PROD com placeholders verifica apenas compilação. `firebase:deploy:prod` não funciona enquanto o alias não existir.

## Secrets

Não versione service-account JSON, private keys, OAuth client secrets, tokens, cookies, App Check debug tokens ou dados reais da migração. `.gitignore` cobre exports conhecidos, checkpoints, cache, PEM/KEY, `.env` e logs. Revise conteúdo e histórico antes de qualquer push. Firebase Browser API Key é configuração pública.
