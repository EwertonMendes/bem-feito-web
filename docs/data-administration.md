# Administração de dados pelo GitHub

## Situação da implantação em 09/10/2026

O executor permanente está nesta PR de infraestrutura, separado do PR #28. **Ainda não está liberado para operações reais.** As duas contas DEV, os papéis personalizados e a federação foram criados e conferidos na API. O snapshot privado foi compartilhado como leitor com ambas as contas. A `master` agora exige PR, uma aprovação, descarte de aprovações antigas, aprovação do último push por outra pessoa e CI `validate`, inclusive para administradores. Os ambientes `data-dev-preview` e `data-dev-execute` aceitam exclusivamente a branch `master`, sem tags e sem bypass administrativo.

Faltam: vincular faturamento ao projeto DEV, provisionar o bucket e seus vínculos IAM, revisar e integrar esta PR à `master`, e executar o smoke test pelo executor revisado. A API de Storage recusou criar o bucket com HTTP 403: `The billing account for the owning project is disabled in state absent`. Nenhum documento de negócio DEV foi modificado. Não houve merge do PR #28, migração ou acesso a dados PROD.

PROD permanece `null` em `tools/data-admin/config.json`: somente `bem-feito-dev` foi encontrado nas configurações e projetos Firebase acessíveis; o ambiente Angular de produção contém placeholders. Nenhum Project ID, identidade ou bucket PROD foi inventado. O executor rejeita qualquer solicitação PROD enquanto faltar configuração real revisada.

## Arquitetura e fronteiras de confiança

```mermaid
flowchart LR
  A[Conector GitHub: JSON em PR + comentário] --> B[Gate na master protegida]
  B --> C[Prévia: identidade DEV de leitura]
  C --> D[Plano imutável em GCS privado]
  D --> E[Autorização com SHA + hash da solicitação + hash do plano]
  E --> F[Gate repetido antes de OIDC]
  F --> G[Backup verificado + transação atômica + recibo]
  G --> H[Leitura de conferência + auditoria privada]
```

`.github/workflows/data-admin.yml` é o único executor permanente. PRs fornecem apenas um JSON, obtido pela API em um SHA imutável; o job privilegiado sempre faz checkout do SHA da `master` usado pelo workflow. Nenhum script do PR recebe credenciais. Para migração, os testes de regras e transações da aplicação do PR #28 rodam em outro job, em emulador, sem OIDC, credenciais de nuvem, token de escrita ou caches compartilhados.

O gate consulta a permissão atual do autor (`write`, `maintain` ou `admin`), compara seu ID com o principal retornado pela API, reconsulta o comentário e exige autor, sender, actor e triggering_actor coincidentes. Rejeita comentário editado, bot, PR fechado, fork, SHA antigo, rerun, branch ou ambiente incorreto. Uma solicitação autorizada pode conter somente as operações e campos do schema. Shell, SQL, JavaScript, consultas arbitrárias e credenciais não são aceitos.

A proteção da branch torna a revisão independente indispensável para mudanças no executor. `CODEOWNERS` identifica os arquivos sensíveis; a regra exige aprovação de outro colaborador com escrita, sem dispensar administradores. Se não houver esse colaborador, o proprietário precisa indicar um revisor confiável; o autor não pode aprovar seu próprio código.

## Identidades, IAM e OIDC

| Identidade DEV | Firestore `(default)` | Arquivo privado planejado |
|---|---|---|
| `github-data-dev-read@bem-feito-dev.iam.gserviceaccount.com` | `datastore.databases.get`, `getMetadata`, `entities.get`, `entities.list` | Ler `plans/`, `backups/`; criar `plans/` |
| `github-data-dev@bem-feito-dev.iam.gserviceaccount.com` | Leitura anterior + `entities.create`, `update`, `delete` | Ler `plans/`, `backups/`, `audit/`; criar `backups/`, `audit/` |

Os papéis de projeto são `dataAdminRead`, `dataAdminWrite`, `dataArchiveRead` e `dataArchiveCreate`. Os vínculos Firestore usam a condição `resource.name == 'projects/bem-feito-dev/databases/(default)'`. A limitação a coleções e campos é aplicada pelo executor; IAM Firestore não oferece uma lista de coleções por esse papel. Nenhuma dessas identidades recebeu Owner, Editor, Auth, Hosting, IAM ou permissões PROD. A identidade existente `github-deploy` e seu provider não foram alterados; ela continua sem escrita de documentos.

Provider novo: `projects/312978463343/locations/global/workloadIdentityPools/github-data/providers/github`. Emissor: `https://token.actions.githubusercontent.com`. Exige repositório `EwertonMendes/bem-feito-web`, repository ID `1406056807`, owner ID `33728924`, branch `refs/heads/master`, ref type `branch`, workflow `EwertonMendes/bem-feito-web/.github/workflows/data-admin.yml@refs/heads/master`, runner GitHub hospedado, evento `issue_comment` ou `workflow_dispatch` e ambiente DEV específico. O subject é `github:<repository_id>:<environment>`; cada conta aceita somente o subject de sua fase, por `roles/iam.workloadIdentityUser`. Não há chaves estáticas. O claim OIDC não substitui a consulta da proteção atual da branch feita pelo gate.

O bootstrap administrativo é `node tools/data-admin/provision.mjs` (mostra plano) e `node tools/data-admin/provision.mjs --apply` (recursos aprovados). Usa a sessão local existente do proprietário no Firebase CLI, com `FIREBASE_TOOLS_MODULE` apontando para o `package.json` instalado do Firebase CLI. Não persiste nem imprime tokens. Reexecução reutiliza recursos e preserva os outros vínculos IAM/etags; diferenças de confiança ou proteção exigem revisão e interrompem a execução. Não faz operações de negócio.

## Pedidos pelo conector GitHub

1. Leia esta documentação e `tools/data-admin/schema.ts` na `master`. Crie uma branch no próprio repositório e um JSON `operations/requests/<nome>.json`. Use ID novo para cada intenção; não inclua dados de clientes. Abra PR contra `master` e obtenha o SHA atual de 40 caracteres. O PR de solicitação permanece aberto durante a operação.
2. Publique no PR um comentário pelo conector autenticado como usuário com escrita:

   ```text
   /data-admin preview operations/requests/<nome>.json <SHA_DO_PR>
   ```

3. Localize a execução **Firebase data administration** em Actions, iniciada pelo comentário. Leia `requestHash`, `planHash`, `requestSha`, caminhos e valores numéricos no resumo do job `operation`. Preview não escreve no Firestore; salva plano e auditoria de prévia no bucket privado.
4. Confira destino, documentos, valores e pré-condições. Em DEV, a autorização específica é outro comentário com os hashes exatos da prévia:

   ```text
   /data-admin apply operations/requests/<nome>.json <SHA_DO_PR> <REQUEST_HASH> <PLAN_HASH>
   ```

5. Confira a conclusão e o resumo: `status: complete`, `validation: readback-verified`, documentos afetados e hash `backup`. Uma repetição com o mesmo ID e conteúdo retorna `already-complete` após verificar o estado atual. Nunca autorize automaticamente um hash diferente porque houve mudança concorrente; faça outra prévia e obtenha nova autorização.

O conector precisa criar commits/PRs/comentários como o usuário autorizado e ler Actions. Um bot GitHub App com principal próprio é recusado. Não é necessário terminal, acesso direto ao Firebase ou chave privada para operações rotineiras. `workflow_dispatch` também aceita PR, path, sha, mode, request_hash e plan_hash na `master`; é a única forma de aplicar em PROD. Não há endpoint HTTP público.

Exemplo de custo: copie `operations/examples/input-cost.json` para requests, substitua o ID do insumo, informe custo anterior e novo em centavos inteiros. O executor recalcula a base de custo, preservando estoque físico, reservado e comprometido. Cadastros simples podem ser criados; alterações financeiras/estoque, troca de propriedade de fragrância ou troca de vínculos de preço exigem migração de domínio registrada e revisada. Delete genérico aceita somente `dataAdminSmoke/smoke-*`; exclusões de negócio são restritas à substituição DEV registrada. Leia o schema para a lista completa de coleções e campos.

## PROD

Após identificar o projeto real, configure contas reader/writer, provider e bucket independentes em uma PR revisada. Cadastre IDs de aprovadores humanos em `productionApprovers`; configure `data-prod-preview` e `data-prod-execute` exclusivamente para `master`. Em execute, exija revisores humanos da lista, prevenção de autoaprovação e `can_admins_bypass: false`. O repositório público atual oferece esses controles de Environment, visíveis nas configurações; uma mudança de visibilidade/plano deve ser reavaliada.

Um humano autorizado deve despachar **apply** com PR, SHA e ambos os hashes específicos. O job para antes de OIDC na aprovação protegida e revalida tudo após a aprovação. Aprovação de PR, push, merge, comentário, CI ou permissão de escrita isoladamente não executam PROD. Sem revisor diferente do solicitante, a operação permanece bloqueada. O provisionador PROD exige configuração real, separada de DEV, e autorização administrativa para seus vínculos.

## Backup, auditoria e recuperação

Bucket planejado: `gs://bem-feito-dev-data-admin`, região `southamerica-east1`, acesso uniforme, prevenção de acesso público, versionamento e retenção mínima de 90 dias. Não será travado irreversivelmente nesta implantação. Não há lifecycle de exclusão. As contas técnicas não podem listar, excluir, atualizar nem sobrescrever objetos, inclusive após a retenção. A retenção é um mínimo; objetos permanecem até decisão administrativa do proprietário.

Planos, backups e auditorias recebem nome SHA-256 do conteúdo. Upload usa `ifGenerationMatch: 0` e CRC32C; download independente confere CRC32C e SHA-256 antes da primeira gravação. Writer pode reler auditoria para essa verificação. Nenhum backup ou exportação privada vira artefato público do Actions. Relatórios públicos mostram caminhos e valores numéricos/bool; strings e estruturas internas são ocultadas.

Antes da transação, há backup e evento `intent` privado com ator, SHA do pedido, SHA do executor, run/comment IDs, horário, escopo, hashes e referência ao backup. A transação verifica versões e relações, aplica todas as alterações, invalida as revisões de dados da aplicação e cria o recibo `dataAdminOperations/<id>`. Uma leitura posterior confere conteúdo e, na migração, o conjunto exato de documentos nas raízes; gera evento `verified`. Repetições geram evento `replay`. Os arquivos de auditoria ficam fora das coleções substituíveis.

Cada operação suporta até 2.000 documentos e 4 MB de linhas codificadas, além dos limites de tamanho/índices/tempo impostos pelo servidor. Firestore removeu o antigo limite de 500 escritas por transação em 2023 ([notas oficiais](https://docs.cloud.google.com/firestore/docs/release-notes#March_29_2023)); os limites de [10 MiB e duração](https://firebase.google.com/docs/firestore/quotas) continuam relevantes. Pedidos genéricos têm no máximo 200 alvos. Não há divisão em lotes que deixe negócio parcialmente substituído; exceder limites aborta sem alterações.

Falha antes ou durante commit mantém o estado anterior pela atomicidade. Falha de rede/conferência após commit não dispara rollback cego: consulte o recibo e o evento privado, repita o mesmo pedido para verificar, ou use restore específico. Isso evita apagar mudanças concorrentes.

Para restaurar, crie outra solicitação:

```json
{
  "schemaVersion": 1,
  "id": "dev-restore-unique-v1",
  "environment": "dev",
  "projectId": "bem-feito-dev",
  "operation": "restore",
  "backup": "<SHA256_DO_BACKUP>",
  "destructive": { "projectId": "bem-feito-dev", "paths": ["<ESCOPO_EXATO_DO_BACKUP>"] }
}
```

Repita preview/apply com SHA e hashes novos. Para migração, `paths` é a mesma lista de coleções e `system/bank-snapshot` da solicitação original. Restore valida destino, caminhos autorizados, versões atuais e relações; restaura tipos Firestore sem perda e faz outro backup antes de gravar. Se surgirem documentos novos fora do backup nas coleções abrangidas, bloqueia a recuperação para revisão. Não copie conteúdo privado do backup para o PR. O proprietário pode consultar o objeto em `https://console.cloud.google.com/storage/browser/bem-feito-dev-data-admin/backups?project=bem-feito-dev`; o hash do resumo corresponde a `backups/<hash>.json`.

## Liberação e smoke test obrigatório

1. O proprietário vincula faturamento em [Billing DEV](https://console.cloud.google.com/billing?project=bem-feito-dev). Reexecute o provisionador aprovado e confira bucket/políticas pela API.
2. Outro colaborador com escrita revisa o código, com CI passando, e integra somente esta PR de infraestrutura à `master`. Não faça merge do PR #28. Não use executor de branch de PR com credenciais para testar antes da revisão.
3. Abra um PR de solicitações copiando os quatro arquivos `dev-smoke-*.json` e o pedido de migração. Execute inspect por preview: documento ausente. Execute create: 10; repita apply para idempotência. Execute update: 20. Crie restore com o backup do update: volta a 10. Execute delete e depois inspect: `exists: false`. Confira os objetos privados e recibos de cada etapa. Nenhum dado real precisa ser modificado nesse teste.
4. Execute preview da migração para verificar ADC/Drive, fonte, projeto, capacidade, estado DEV e backup/plano privado. Não publique apply da migração durante a validação da infraestrutura.
5. Somente depois do sucesso real desse fluxo, retire `.github/workflows/migration-dev-trusted-temporary.yml` por PR revisada e revogue a leitura do snapshot concedida à antiga `github-deploy`. Não use mais os comandos temporários. Esta PR não concede escrita à identidade antiga.

O teste negativo de CI `deny-untrusted-data-oidc` usa um JWT real de branch não confiável e exige rejeição pela confiança do provider; nunca imprime JWT/access token. Testes locais de autorização simulam a API GitHub, cobrindo falta de escrita, forks, SHAs antigos, comentários alterados, reruns, branch desprotegida e proteção PROD. A suíte do emulador usa `demo-bem-feito`, testa dry-run, backup/restore, concorrência, relações, idempotência, colisão de IDs e transação/restauração de 600 documentos; seu armazenamento injetado não comprova IAM/GCS real. Os testes positivos de WIF, Firestore e GCS reais continuam pendentes até os passos 1–3.

## Migração do PR #28

Pedido preparado: `operations/requests/dev-migration-20261009.json`. Registro permitido: `legacy-sheets-v1`, somente `bem-feito-dev`. O planner exige que o SHA indicado continue sendo o head do PR #28 aberto e não integrado, tenha CI push bem-sucedida e esteja publicado no `deployment.json` do DEV. Os jobs isolados executam os testes de transações e regras da aplicação antes de credenciais administrativas.

Reutiliza os scripts fetch, convert, normalize, reconcile e validate inspecionados no SHA `08d4951142881bc2f34aaae46c4ebbd07063cc75` do PR #28. Os wrappers import/verify/replace e o backup no mesmo Firestore foram substituídos pela transação e GCS permanentes. Leitura exclusiva do snapshot privado configurado, jamais alteração da planilha oficial.

Prévia exporta de novo, normaliza e concilia, exige 0 erros, 25 vendas, 24 recebimentos, 45 produções, 16 despesas, saldo 48.169 centavos, aportes em bens 85.311 centavos, V00024 em produção e V00025 pronta. A exportação privada conferida nesta tarefa passou com 0 erros e 19 avisos de custo ausente, que não foram preenchidos artificialmente. Tem 463 documentos de negócio conciliados; a união dos atuais e futuros soma 569 raízes, além de descendentes históricos explicitamente aceitos e backupados. Alteração de fonte ou versão do destino entre preview/apply exige nova autorização.

Substitui somente as 21 coleções listadas no pedido e `system/bank-snapshot`, preservando Auth, `users`, integrações, recibos e configurações estruturais. Descendentes não registrados bloqueiam o plano. Backup integral dos documentos abrangidos precede a transação. Conferência compara cada conteúdo e os conjuntos exatos de IDs; registros antigos ausentes da fonte são excluídos, incluindo dados fictícios. E2E do negócio ocorre exclusivamente no emulador. Se o aplicativo mudar no PR #28, atualize `deploymentSha` no JSON e obtenha novos hashes; não reautorize uma versão diferente implicitamente.

Instrução para outra instância do ChatGPT, **após liberação e smoke test**:

> Em EwertonMendes/bem-feito-web, sem merge do PR #28, use data-admin.yml e legacy-sheets-v1 no DEV bem-feito-dev. Abra um PR de solicitação com operations/requests/dev-migration-20261009.json atualizado para o SHA do PR #28 publicado no DEV. Pelo conector GitHub, comente /data-admin preview seguido do caminho e SHA desse novo PR; confira os totais, E2E isolados e hashes. Com a autorização do proprietário para esse plano, comente /data-admin apply com caminho, SHA, requestHash e planHash exatos. Confira readback-verified, os IDs da fonte e a ausência dos IDs antigos fora dela; informe o link da execução e gs://bem-feito-dev-data-admin/backups/<backup>.json. Preserve o backup para restore e não execute nada em PROD.

## Revogação e manutenção

Para interromper operações, desabilite o workflow em Actions e o provider novo `github-data/github` no projeto DEV. Remova `roles/iam.workloadIdentityUser` da conta/fase comprometida ou desabilite a conta; revogue acesso ao snapshot em Drive. Não toque no provider `github-actions/github` usado pelo deploy. Credenciais já emitidas expiram; a revogação do vínculo não apaga backups. O proprietário deve revisar recibos/auditoria antes de retomar.

Toda ampliação de operação/coleção/campo, destino PROD, aprovador ou confiança OIDC passa por PR revisada. Fixe Actions em SHAs revisados e mantenha dependências/lockfile. Configure a retenção de auditoria de acordo com o uso real, preservando o mínimo aprovado; não crie exclusão automática de backups como parte de uma operação de negócio.
