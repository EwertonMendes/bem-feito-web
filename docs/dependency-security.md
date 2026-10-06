# Segurança de dependências

## Política

A CI separa duas verificações diferentes:

- `npm run security:scan` procura credenciais e secrets versionados;
- `npm run security:audit` verifica vulnerabilidades conhecidas nas dependências que fazem parte da aplicação de produção.

A instalação usa `npm ci --no-audit --no-fund` para evitar que o audit automático do npm misture dependências de runtime com ferramentas locais. O audit explícito roda logo depois e falha a CI para qualquer vulnerabilidade de produção fora da exceção documentada abaixo.

Não use `npm audit fix --force`. Uma correção automática que troca versões maiores pode alterar Angular, Firebase ou ferramentas de build sem uma migração revisada.

## Exceção temporária do Firestore

Em 05/10/2026, `firebase@12.19.0` é a versão atual usada pelo projeto e `@firebase/firestore@4.17.2` ainda declara `@grpc/grpc-js: ~1.9.0`.

O npm reporta:

- `GHSA-m9gg-hp2v-232j`;
- `GHSA-f596-whhp-79r4`.

Esses avisos atingem o transporte gRPC de Node. O Bem Feito é uma SPA Angular publicada no Firebase Hosting. O Firestore seleciona o bundle `browser`, que usa WebChannel; o transporte gRPC fica no export `node` e não é carregado pela aplicação publicada.

O próprio repositório do Firebase acompanha essa limitação em:

- https://github.com/firebase/firebase-js-sdk/issues/10400

A declaração atual de exports e dependências do Firestore pode ser conferida em:

- https://github.com/firebase/firebase-js-sdk/blob/main/packages/firestore/package.json

A exceção da CI é deliberadamente estreita: somente os dois IDs acima e somente a cadeia `firebase -> @firebase/firestore-compat -> @firebase/firestore -> @grpc/grpc-js` podem passar. Qualquer novo advisory, novo pacote vulnerável ou mudança nessa cadeia faz `npm run security:audit` falhar.

A exceção deve ser removida assim que o Firebase publicar uma versão compatível que deixe de instalar uma versão vulnerável de `@grpc/grpc-js`.

## Dependências de desenvolvimento

`npm audit` sem `--omit=dev` também analisa ferramentas como `firebase-tools`, emuladores e dependências transitivas que não entram no bundle Angular publicado.

Esses achados devem ser revisados e atualizados quando houver release compatível, mas não são tratados como vulnerabilidades de runtime do site. Em especial, em 05/10/2026 existem advisories transitivos em ferramentas do Firebase para os quais o npm sugere downgrade ou `--force`; essas ações não devem ser aplicadas automaticamente.

Para investigar manualmente:

```powershell
npm audit --omit=dev
npm audit
npm ls <pacote>
```

O primeiro comando representa a superfície de dependências publicada pelo aplicativo. O segundo inclui toda a toolchain local.
