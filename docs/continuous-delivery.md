# Entrega contínua do DEV

## Objetivo

Depois que um pull request é mergeado em `master`, a workflow `CI` valida o commit de merge. Somente se essa execução terminar com sucesso a workflow `Deploy DEV` pode publicar o mesmo commit em `bem-feito-dev`.

O fluxo automático fica desativado até a variável de repositório `DEV_AUTO_DEPLOY_ENABLED` ser definida como `true`. O disparo manual continua disponível para validar a configuração antes de ativar a automação.

## Fluxo

```text
PR
  -> merge em master
    -> CI no commit de master
      -> security scan
      -> architecture tests
      -> npm audit
      -> unit tests
      -> Firestore Rules tests
      -> transaction tests
      -> build DEV
      -> build PROD
        -> sucesso
          -> Deploy DEV
            -> confirma que o commit veio de PR mergeado
            -> checkout do SHA validado
            -> build DEV
            -> autenticação keyless por OIDC/WIF
            -> deploy Firestore + Hosting
            -> verifica deployment.json no site publicado
```

Commits diretos em `master` não são publicados automaticamente. A workflow consulta os pull requests associados ao SHA e exige um PR fechado e mergeado para `master`.

A concorrência usa o grupo `bem-feito-dev` com cancelamento do deploy anterior. Se dois PRs forem mergeados em sequência rápida, somente o commit mais recente continua sendo publicado.

## Autenticação

O deploy não usa `FIREBASE_TOKEN`, service-account JSON ou qualquer outra credencial de longa duração no GitHub.

A autenticação usa GitHub OIDC com Google Cloud Workload Identity Federation e a service account:

```text
github-deploy@bem-feito-dev.iam.gserviceaccount.com
```

Provider esperado:

```text
projects/312978463343/locations/global/workloadIdentityPools/github-actions/providers/github
```

## Configuração única no Google Cloud

Abra o Google Cloud Console no projeto `bem-feito-dev`, abra o Cloud Shell e execute:

```bash
gcloud config set project bem-feito-dev

gcloud services enable iamcredentials.googleapis.com sts.googleapis.com

gcloud iam service-accounts create github-deploy \
  --display-name="GitHub DEV Deploy"

for ROLE in \
  roles/firebase.viewer \
  roles/firebasehosting.admin \
  roles/firebaserules.admin \
  roles/datastore.indexAdmin \
  roles/serviceusage.serviceUsageConsumer
do
  gcloud projects add-iam-policy-binding bem-feito-dev \
    --member="serviceAccount:github-deploy@bem-feito-dev.iam.gserviceaccount.com" \
    --role="$ROLE"
done

gcloud iam workload-identity-pools create github-actions \
  --location=global \
  --display-name="GitHub Actions"

gcloud iam workload-identity-pools providers create-oidc github \
  --location=global \
  --workload-identity-pool=github-actions \
  --display-name="GitHub" \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref" \
  --attribute-condition="assertion.repository=='EwertonMendes/bem-feito-web' && assertion.ref=='refs/heads/master'"

gcloud iam service-accounts add-iam-policy-binding \
  github-deploy@bem-feito-dev.iam.gserviceaccount.com \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/312978463343/locations/global/workloadIdentityPools/github-actions/attribute.repository/EwertonMendes/bem-feito-web"
```

Os nomes acima são os mesmos versionados em `.github/workflows/deploy-dev.yml`. Não crie chave JSON para essa service account.

## Primeiro teste

Depois que esta workflow estiver em `master` e o Workload Identity Federation estiver configurado:

1. Abra `Actions > Deploy DEV`.
2. Clique em `Run workflow`.
3. Use a branch `master`.
4. Aguarde o job `deploy` ficar verde.
5. Abra `https://bem-feito-dev.web.app/deployment.json`.
6. Confirme que `environment` é `dev` e que `commit` é o SHA da `master` publicada.

A própria workflow repete essa verificação automaticamente depois do deploy e falha se o site não servir o SHA esperado.

## Ativação automática

Depois do primeiro deploy manual bem-sucedido:

1. Abra `Settings > Secrets and variables > Actions > Variables`.
2. Crie a variável:
   - nome: `DEV_AUTO_DEPLOY_ENABLED`
   - valor: `true`

A partir daí, um PR mergeado em `master` será publicado automaticamente somente depois que a CI do commit de `master` passar.

Para pausar deploys automáticos sem alterar código, troque a variável para `false` ou remova-a. O disparo manual permanece disponível.

## Verificação local

Para verificar qual commit está publicado:

```powershell
$env:DEPLOY_COMMIT = (git rev-parse HEAD)
npm run deploy:verify:dev
```

O comando termina com sucesso somente quando DEV estiver servindo exatamente esse SHA.
