# Segurança de dependências

## Política

O projeto mantém o `npm audit` limpo no estado versionado. Não usamos allowlist para esconder advisories conhecidos.

A CI executa `npm ci` e, em seguida, o `npm audit` normal por meio de `npm run security:audit`. Qualquer vulnerabilidade reportada pelo npm faz a validação falhar.

Não use `npm audit fix --force`. Mudanças de versão precisam ser revisadas e testadas explicitamente.

## Firestore e gRPC

Em outubro de 2026, `firebase@12.19.0` / `@firebase/firestore@4.17.2` ainda declara `@grpc/grpc-js: ~1.9.0`, embora `@grpc/grpc-js@1.14.5` contenha as correções dos advisories `GHSA-m9gg-hp2v-232j` e `GHSA-f596-whhp-79r4`.

O projeto usa um `overrides` raiz, recurso suportado pelo npm, limitado ao filho de `@firebase/firestore`:

```json
{
  "overrides": {
    "@firebase/firestore": {
      "@grpc/grpc-js": "1.14.5"
    }
  }
}
```

Isso substitui a dependência transitiva vulnerável por uma versão corrigida da mesma major. A issue upstream é https://github.com/firebase/firebase-js-sdk/issues/10400.

Esse override deve ser removido quando o Firebase passar a resolver nativamente uma versão corrigida.

## Firebase CLI

`firebase-tools` foi removido das `devDependencies`. A CLI não faz parte da aplicação Angular e sua árvore transitiva estava introduzindo advisories no `node_modules` do projeto.

Os scripts usam uma versão fixa da CLI sob demanda:

```bash
npx --yes --package firebase-tools@15.32.1 firebase ...
```

Isso mantém emuladores e deploy reproduzíveis sem incorporar toda a árvore da CLI ao projeto.

## gaxios e uuid

Uma dependência de desenvolvimento usa `gaxios`, cuja faixa podia selecionar uma versão vulnerável de `uuid`. O projeto aplica um override limitado a esse pai:

```json
{
  "overrides": {
    "gaxios": {
      "uuid": "11.1.1"
    }
  }
}
```

`uuid@11.1.1` contém a correção de `GHSA-w5hq-g745-h8pq`.

## Resultado esperado

```powershell
npm ci
npm audit
```

Ambos devem terminar sem vulnerabilidades. Os overrides são específicos e devem ser removidos quando as dependências upstream deixarem de precisar deles.
