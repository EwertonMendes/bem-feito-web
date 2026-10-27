# Bem Feito: runbook de ambientes e primeira implantação PROD

> Status: pré-infraestrutura. Este PR não pode ser promovido à produção até o manifesto do Codex, CI verde, backup/restore verificados e homologação humana.

## Arquitetura

- DEV: Firebase "bem-feito-dev", Worker "bem-feito-drive-dev", banco D1 e Drive de testes.
- PROD: projeto Firebase, Worker, banco D1, OAuth e pasta Drive exclusivos. Não usar nenhuma credencial ou project ID de DEV.
- Código: feature PR -> CI -> DEV -> merge master -> CI/master -> promoção manual (Worker, depois Firebase) -> PROD.
- Dados: nunca sincronizados automaticamente de DEV. Carga inicial somente a partir de fonte real reconciliada, com backup e verificação de relações e referências das imagens.
- Cada release PROD exige SHA exato da master protegida, PR mergeada, CI/master com sucesso, mesmo SHA do frontend publicado em DEV e aprovação do GitHub Environment. Worker PROD também exige o mesmo SHA publicado e validado no Worker DEV.

## Contrato com o Codex (infraestrutura externa)

Provisionar Firebase PROD (Hosting/Auth Google/Firestore Native), contas IAM e Workload Identity Federation para deploy e administração de dados, projeto de arquivo privado independente, OAuth server e Picker, Worker Cloudflare/D1 PROD, segredos do Worker, token Cloudflare mínimo e pasta Drive PROD.

Codex NÃO altera os arquivos do repositório, DEV ou seus recursos. Sem IDs presumidos, chaves permanentes de service account ou faturamento automático.

### GitHub Environment: prod

Proteger environment com revisão humana do proprietário e restrição à master. Exigir exatamente um revisor (proprietário), prevent_self_review=false e can_admins_bypass=false; os jobs consultam a configuração por API antes de qualquer autenticação/deploy e recusam environments não protegidos ou criados automaticamente. Adicionar as seguintes **Environment variables** (configuração pública, não secrets):

| Nome | Valor |
| --- | --- |
| PROD_FIREBASE_PROJECT_ID | Firebase project ID PROD |
| PROD_FIREBASE_API_KEY | Firebase Web API key pública |
| PROD_FIREBASE_AUTH_DOMAIN | Nome completo: projectId.firebaseapp.com |
| PROD_FIREBASE_STORAGE_BUCKET | Storage bucket indicado pelo Firebase Web config |
| PROD_FIREBASE_MESSAGING_SENDER_ID | Número de projeto PROD |
| PROD_FIREBASE_APP_ID | Web App ID PROD |
| PROD_FRONTEND_ORIGIN | Origin HTTPS PROD sem barra final, normalmente https://projectId.web.app |
| PROD_APPROVED_CUSTOM_ORIGIN | Opcional; somente para origin alternativo aprovado |
| PROD_WORKER_ORIGIN | Origin HTTPS do Worker Cloudflare PROD, sem barra final |
| PROD_GOOGLE_PICKER_CLIENT_ID | OAuth client ID público do Picker |
| PROD_GOOGLE_PICKER_API_KEY | API key pública do Google Picker com restrições por origem e API |
| PROD_GOOGLE_CLOUD_PROJECT_NUMBER | Número de projeto Google Cloud associado ao Picker |
| PROD_GOOGLE_OAUTH_SERVER_CLIENT_ID | OAuth Web client ID exclusivo do Worker |
| PROD_OAUTH_REDIRECT_URI | PROD_WORKER_ORIGIN + /oauth/drive/callback |
| PROD_WORKER_NAME | Nome exato do Worker Cloudflare PROD |
| PROD_D1_DATABASE_NAME | Nome exato do D1 PROD |
| PROD_D1_DATABASE_ID | UUID real do D1 PROD |
| PROD_TOKEN_KEY_VERSION | Versão da chave de criptografia, geralmente v1 |
| PROD_OAUTH_ENABLED | "false" até homologar OAuth, depois "true" |
| PROD_WIF_PROVIDER | Caminho completo do Workload Identity Provider de deploy PROD |
| PROD_DEPLOY_SERVICE_ACCOUNT | E-mail da service account PROD exclusiva de deploy |

**Environment secrets do GitHub para Cloudflare**: CLOUDFLARE_ACCOUNT_ID e CLOUDFLARE_API_TOKEN. O token deve ter escopo mínimo de publicação de versões do Worker PROD; confirmar as permissões de leitura de metadados/bindings exigidas pelo Wrangler.

**Secrets do Worker no Cloudflare**: GOOGLE_CLIENT_SECRET e TOKEN_KEYS, ambos exclusivos de PROD, nunca disponibilizados ao frontend/GitHub Actions/artifacts. Configurar separadamente depois de criar o Worker.

### Environments de dados

- data-prod-preview: leitura autorizada para planos e backups, exclusivamente master.
- data-prod-execute: operações administrativas aprovadas, exclusivamente master, aprovação específica e sem bypass administrativo.
- Seguir exatamente tools/data-admin/gate.ts e docs/data-administration.md para proteção do único mantenedor.
- tools/data-admin/config.json ainda contém environments.prod = null. Não preencher com IDs inventados. Após o Codex entregar IDs reais, atualizar em PR: projectId, projectNumber, provider, reader, writer e archive PROD.
- O pipeline data-admin.yml permite pedidos prod com preview / apply e hashes imutáveis, mas permanece inacessível enquanto prod = null. O modo query pode consultar DEV ou PROD com resultados criptografados após configurar o destino e o reader PROD. O modo direct continua exclusivamente DEV; alterações em PROD usam preview, aprovação e apply. OIDC e Environment garantem isolamento.
- Não executar mutações comerciais sem backup externo em arquivo privado PROD e readback verificado.

No GitHub Environment **data-prod-preview**, o Codex deve definir as variáveis PROD_FIREBASE_PROJECT_ID, PROD_DATA_WIF_PROVIDER e PROD_DATA_READER_ACCOUNT, iguais aos valores reais versionados em tools/data-admin/config.json. O workflow revalida essas três identidades antes de obter OIDC. Para consultas privadas, selecionar target_environment=prod e usar um QueryPlan com environment=prod e projectId real. Até a configuração existir, PROD é rejeitado.

## Estratégia de configuração

As configurações públicas de PROD não são armazenadas em arquivos estáticos com placeholders trocados manualmente.

- Angular: tools/deploy/prepare-prod-environment.mjs gera o arquivo de build production a partir das variáveis de Environment, validando identidades distintas de DEV. O arquivo original versionado permanece com placeholders, sem necessidade de código gerado em CI de DEV.
- Worker: tools/deploy/prepare-prod-worker-config.mjs gera temporariamente worker/wrangler.generated.prod.jsonc (gitignored) com ambiente prod próprio, bindings D1 reais e OAuth inicialmente desativado.
- PROD exige deploy via dois workflows manuais protegidos: Deploy Drive Worker PROD (manual promotion) e Deploy PROD (manual promotion).
- npm run firebase:deploy:prod direto foi bloqueado para evitar o antigo comando baseado no alias incompleto da Firebase CLI.
- Nenhum upload ou deploy automático para PROD é disparado por PR/merge. CI valida a configuração do pipeline sem ter acesso a tokens PROD.

## Primeira publicação

1. Receber manifesto do Codex com IDs reais, confirmação dos Environments e IAM mínimo. Proibir quaisquer apontamentos PROD -> DEV.
2. Revisar e mergear a PR de código após testes e CI verde. A implantação DEV deve ter o mesmo SHA da master. Para publicar o Worker em PROD, executar previamente o workflow DEV "Deploy Drive Worker DEV" manualmente na master, com o mesmo SHA, e verificar o health check; o gate PROD exige o sucesso dessa publicação DEV.
3. Com OAuth desativado e migrations D1 PROD verificadas, disparar o workflow **Deploy Drive Worker PROD** da master, informando o SHA completo homologado. Exigir sucesso no health endpoint com environment = production.
4. Disparar **Deploy PROD** da master com o mesmo SHA. Para a carga inicial definir deploy_firestore=true, após revisar impactos de índice. O workflow publica Rules/índices, espera READY, executa consultas de verificação e só então publica Hosting. Verifica deployment.json no site publicado com commit e environment=prod.
5. Criar/autorizar separadamente perfis users/UID no Firebase PROD; a conta Google em Firebase Auth PROD recebe outro UID. Autenticação PROD deve permanecer isolada do DEV.
6. Configurar pasta Drive PROD, OAuth e permissões no usuário correto. Após testes de Google Picker, consentimento, renovação, upload, leitura, substituição e lixeira, definir PROD_OAUTH_ENABLED=true e republicar Worker aprovado.
7. Planejar e executar carga inicial real **auditada**. Não copiar DEV inteiro: reconciliar fonte real de estoque, vendas, pagamentos, despesas, produção, encomendas, configurações e contadores, transferir imagens para pasta PROD e mapear fileIds mantendo integridade e permissões.
8. Homologar desktop/mobile com teste mínimo não destrutivo: login, listagem, relatórios, autorização, referências de imagens, transações, HTTPS/CORS, consulta de auditoria e backups verificados.
9. Confirmar primeiro snapshot periódico completo e **testar restore em ambiente de recuperação isolado** antes de operação diária. Administração de dados e Workflows de deploy não substituem este requisito.

## Operação e rollback

- DEV mostra aviso visual persistente de ambiente de testes. PROD não mostra aviso DEV.
- A promoção é manual; não disponibilizar jobs PROD para branch de PR.
- Para rollback de código, usar PR de revert, CI e nova homologação DEV (ou procedimento emergencial do provedor com aprovação/documentação). Reverter código não reverte mudanças Firestore/D1.
- Para migrações de schema usar estratégia expand-migrate-contract, backup e testes de restore antes de mudanças destrutivas.
- Firestore backups periódicos completos, retenção e restauração D1 ficam **pendentes de implementação e homologação**; não chamar PROD pronta até estarem operacionais.
- É proibido faturamento/upgrade automático sem consentimento do proprietário.

## Evidência mínima por entrega

Registrar SHA, link da CI, GitHub Environment aprovado, URL/identidade de hospedagem e Worker, projeto Firebase exato, resultado dos checks, versões publicadas, plano de rollback, estado do backup e integridade dos documentos. Nunca publicar conteúdo comercial individual, refresh tokens, segredos ou dumps sensíveis nos logs dos Actions.
