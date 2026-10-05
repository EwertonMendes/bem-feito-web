# Desenvolvimento local

Use Node 22.22.3 ou superior compatível com `package.json`.

```powershell
npm ci
Copy-Item .env.example .env.local
# Preencha FIREBASE_DEV_API_KEY em .env.local com a chave do Web App DEV.
npm run security:scan
npm test
npm run test:migration
npm run build:dev
npm start
```

Abra `http://localhost:4200`. DEV real usa `bem-feito-dev`. Google Authentication está habilitado e localhost autorizado. O acesso exige `users/{UID}` com `active: true`; a conta Google sozinha não libera o aplicativo.

`npm start`, `npm run build:dev` e `npm run build:dev:hosting` geram `src/environments/environment.generated.ts` usando `FIREBASE_DEV_API_KEY` de `.env.local` ou da variável de ambiente do processo. O arquivo gerado e os arquivos `.env*` locais são ignorados pelo Git. Não copie a chave de volta para `environment.ts`.

Se `npm ci` retornar EBUSY no Sass, pare o `npm start` deste projeto, instale as dependências e reinicie. Não encerre processos de outros projetos.

## Emuladores

Java precisa estar disponível para os emuladores Firestore e Storage.

```powershell
npm run test:rules
npm run test:transactions
```

Esse comando inicia Firestore e Storage exclusivamente em `demo-bem-feito`, executa testes de autorização/schema e encerra os emuladores. Nunca aponte testes de rules para PROD.

Para testes manuais, execute em um terminal:

```powershell
npm run firebase:emulators -- --project demo-bem-feito
```

Configure temporariamente `useEmulators: true` e `firebase.projectId: 'demo-bem-feito'` no environment gerado de desenvolvimento. Use configuração Web de demonstração no lugar dos IDs do projeto real, mantenha `emulatorHost: '127.0.0.1'` e reinicie Angular. Emulator UI: `http://localhost:4000`; Auth: 9099; Firestore: 8080; Storage: 9199.

Restaure o environment real ao terminar. Não publique um build com `useEmulators: true`.

Neste Windows com Java 25, o runtime Storage emite avisos de compatibilidade no encerramento, e Firestore pode deixar processo residual na porta 8080. Se necessário, identifique o processo `demo-bem-feito` e encerre apenas esse Emulator antes de repetir testes.

## Validação real

Em 05/10/2026 foram verificados login Google, acesso negado sem perfil, primeiro owner, Dashboard, refresh mantendo sessão e cadastro/atualização sem imagem. Os nove cadastros descartáveis da configuração foram arquivados com cópia recuperável após a migração real.

Hosting DEV está publicado e a migração foi conferida por readback e reconciliação financeira. Vendas, recebimentos, estornos, cancelamento, produção, compras e ajustes foram testados com os repositories e Rules reais nos emuladores. Imagens e App Check estão adiados por decisão do usuário. Consulte [firebase-setup.md](firebase-setup.md) e [migration-dev.md](migration-dev.md) antes de preparar PROD.

## Builds

```powershell
npm run build:dev
npm run build:prod
```

O build PROD pode compilar mesmo com placeholders. Isso apenas verifica compilação e não o torna publicável; PROD continua pendente.

Para publicar DEV, use `npm run firebase:deploy:dev`. A configuração `dev-hosting` mantém o Firebase DEV, otimiza o bundle e gera nomes com hash, sem sourcemaps. O deploy não inclui Storage. Localmente, imagens também ficam desabilitadas e todos os cadastros podem ser salvos sem elas.

Não versione tokens, chaves privadas, credenciais administrativas, `.env` com valores, App Check debug tokens ou dados empresariais. A Firebase Web API Key é pública por design, mas a política deste repositório é injetá-la localmente para evitar alertas de credencial e reutilização acidental. Authentication, Security Rules e API restrictions são as barreiras reais de segurança.
