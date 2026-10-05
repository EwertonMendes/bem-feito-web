# Configuração Firebase

Use dois projetos diferentes:

- DEV: desenvolvimento, testes e migrações de validação.
- PROD: operação real.

Nunca use o mesmo Firestore para os dois ambientes.

## Web Apps

Registre um Web App chamado `Bem Feito Web` em cada projeto e copie o objeto `firebaseConfig`.

DEV:

```text
src/environments/environment.ts
```

PROD:

```text
src/environments/environment.production.ts
```

## Aliases

Edite `.firebaserc`:

```json
{
  "projects": {
    "dev": "SEU_PROJECT_ID_DEV",
    "prod": "SEU_PROJECT_ID_PROD"
  }
}
```

## Authentication

Ative Google Sign-In nos dois projetos.

## Firestore

Crie o banco em Native mode e publique rules/indexes:

```bash
npx firebase-tools login
npx firebase-tools use dev
npx firebase-tools deploy --only firestore:rules,firestore:indexes

npx firebase-tools use prod
npx firebase-tools deploy --only firestore:rules,firestore:indexes
```

## Storage

Crie o bucket em cada projeto e publique as regras:

```bash
npx firebase-tools use dev
npx firebase-tools deploy --only storage

npx firebase-tools use prod
npx firebase-tools deploy --only storage
```

## Primeiro usuário owner

Faça login uma vez no app. Depois copie o UID da conta no Firebase Authentication e crie manualmente:

```text
users/{UID}
```

com:

```json
{
  "email": "seu-email@gmail.com",
  "displayName": "Administrador",
  "role": "owner",
  "active": true
}
```

Também existe o helper:

```bash
FIREBASE_PROJECT_ID=seu-projeto node tools/admin/upsert-user.mjs email@exemplo.com owner
```

Ele exige credenciais administrativas locais.

## Deploy

DEV:

```bash
npm run firebase:deploy:dev
```

PROD:

```bash
npm run firebase:deploy:prod
```

## Migração da planilha

1. Adicione temporariamente `tools/migration/export-legacy.gs` ao Apps Script atual.
2. Execute `bemfeito_exportMigrationJson()`.
3. Baixe o JSON e salve como `tools/migration/legacy-raw.json`.
4. Execute:

```bash
npm run migration:normalize
npm run migration:validate
npm run migration:reconcile -- tools/migration/migration-data.json 2026-09-02 2026-10-01
```

5. Importe primeiro no DEV:

```bash
FIREBASE_PROJECT_ID=seu-projeto-dev npm run migration:import
```

6. Só depois de reconciliar vendas, estoque, contas a receber e dashboard, repita em PROD.
