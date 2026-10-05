# Auditoria da Firebase Web API Key — 05/10/2026

## Conclusão e evidências

O alerta GitHub Secret Scanning #1 reconheceu uma Google API Key real, mas o valor é a configuração pública do Firebase Web DEV, não uma credencial administrativa. Ocultá-lo em `.env` não altera sua exposição no bundle. A documentação oficial permite versionar essa configuração quando restrita aos serviços Firebase.

A chave detectada foi comparada com a Browser key exibida no Google Cloud Console e os valores coincidem. Projeto: `bem-feito-dev` (número `312978463343`); chave `f0ec69f1-5b57-4e7b-833b-118c9e6893c2`, nome `Browser key (auto created by Firebase)`. Nenhum valor de token ou segredo administrativo é reproduzido neste relatório.

O Console mostrou 25 APIs selecionadas, conta vinculada ausente e application restrictions `Nenhum`. A lista observada foi:

- Cloud Datastore, Cloud Firestore, Cloud Logging, Cloud SQL Admin e Cloud Storage for Firebase;
- FCM Registration;
- Firebase AI Logic, App Check, App Distribution, App Hosting, App Testers, Hosting, In-App Messaging, Installations, Management, ML, Phone Number Verification, Realtime Database Management, Remote Config, Remote Config Realtime, Rules e SQL Connect;
- Identity Toolkit, ML Kit e Token Service.

Não há Generative Language API (Gemini Developer API), Maps/Places ou Cloud Translation nessa lista. Firebase AI Logic é uma API distinta de Generative Language; a chave pública não autoriza operações administrativas Cloud SQL/Firestore/IAM. A allowlist provisionada inclui serviços além dos usados atualmente; sua redução opcional exige verificar dependências e testar login antes de salvar. Não foi identificada necessidade de rotação ou alteração emergencial de restrições.

O Console Firebase confirmou o plano Spark. O código inicializa somente App, Auth, Firestore e Storage via SDK cliente; não há Firebase Admin no bundle nem inicialização App Check. A documentação existente registra Storage não provisionado e App Check adiado. Ausência de referrer restrictions/App Check deixa endpoints públicos sujeitos a abuso de quota; chave pública não significa risco zero. Domínios autorizados de Authentication não substituem restrições da API key.

## Arquitetura e PR #1

DEV permanece em `src/environments/environment.ts`. PROD permanece em `environment.production.ts`, com placeholders, sem alias PROD em `.firebaserc`. O replacement Angular padrão substitui DEV somente no build production; development e dev-hosting usam DEV. O build PROD compila, mas não constitui uma aplicação configurada/publicável. Crie um projeto separado e copie apenas seu Web config público antes de publicar.

Removidos do PR #1: `.env.example` para a chave DEV, geração de `environment.generated.ts`, hooks prestart/prebuild, replacements DEV extras e instruções que tornavam `.env.local` obrigatório. A chave DEV voltou ao environment versionado. Nenhum secret de CI é necessário para builds.

Mantida e aprimorada a proteção útil do scanner local/CI: apenas os SHA-256 das chaves públicas de navegador DEV auditadas no caminho exato são permitidos. A allowlist cobre a Firebase Web API Key e a Google Picker API Key usada pela SPA. Outra chave no mesmo arquivo, qualquer uma das chaves em outro arquivo ou segredos reais continuam sendo sinalizados. PROD não tem exceção automática. O scanner percorre todas as ocorrências, não imprime valores, detecta padrões de private keys/service account, OAuth/refresh tokens, GitHub/AWS/Slack, Stripe/OpenAI, URLs de banco com senha e atribuições comuns de secrets/debug tokens. Testes verificam essas fronteiras. É uma defesa parcial por padrões, não uma garantia matemática contra todos os formatos de segredo.

`.gitignore` continua excluindo `.env`, PEM/KEY, dados privados de migração e logs, e amplia nomes comuns de credenciais Google. Ignore não protege arquivos já rastreados. Revise todo diff e mantenha GitHub Secret Scanning e push protection habilitados; nenhuma exclusão para `src/environments/**` foi adicionada.

## Credenciais que nunca podem entrar no Git/frontend

| Material | Tratamento |
| --- | --- |
| Firebase Web config auditado | Público, restrito aos serviços Firebase; projects DEV/PROD separados |\n| Google Picker API Key auditada | Pública no bundle da SPA; restringir por HTTP referrer e somente às APIs Drive/Picker necessárias |
| Conta de serviço | Identidade IAM; o e-mail não é segredo, mas seu JSON com private key é secreto |
| Private key / Firebase Admin credentials | Autorização administrativa; backend/ADC, nunca frontend |
| OAuth client secret, refresh/access token, token administrativo | Segredo que permite autenticação/autorização; nunca versionar |
| App Check debug token | Permite contornar atestação; nunca versionar |
| Senha/URL de banco, Stripe secret, OpenAI/Gemini key | Segredo de serviço/autorização/cobrança; backend/secret manager |
| Outras Google API Keys | Avaliar serviço e restrições; nunca liberar APIs faturáveis na Browser key pública |

Scripts Admin usam ADC ou a sessão já autenticada da Firebase CLI, sem exportar tokens. Admin SDK passa fora das Security Rules: execute apenas em ambiente administrativo e preserve a validação dos scripts.

## Barreiras de dados e limites

Firestore exige autenticação e perfil ativo para dados operacionais, diferencia owner/operator/viewer e nega caminhos desconhecidos. Escalada de perfil pelo próprio operator/viewer é negada. Storage exige perfil ativo para leitura e owner/operator para gravação, com limites de tamanho/MIME e negação fora de `catalog/**`. Não foi alterada nenhuma Rule nesta correção.

As listas internas e vínculos financeiros entre documentos ainda precisam de validação mais profunda antes de PROD, como já documentado em `firebase-setup.md`. Nesta auditoria, o release `projects/bem-feito-dev/releases/cloud.firestore` foi consultado pela API oficial com a sessão Firebase já autorizada: o conteúdo publicado corresponde ao arquivo local (normalizando CRLF e whitespace final). Storage preparado localmente não implica bucket real configurado. Logs de abuso, cobrança e quotas não foram auditados integralmente nesta tarefa; não é possível afirmar ausência de uso indevido histórico.

## Alerta GitHub e ações posteriores

O alerta #1 foi resolvido via API GitHub em 05/10/2026 como **false positive** quanto a segredo sensível, após comparar também o valor do alerta com a chave auditada. Novos alertas de Google API Key devem ser avaliados pelo mesmo critério: confirmar que o valor é uma chave pública de navegador esperada, verificar as restrições no Google Cloud e nunca resolver automaticamente apenas por corresponder ao formato. A API retornou `state: resolved` e `resolution: false_positive`. Não usar `used in tests` (DEV é real) nem `revoked` (a chave continua em uso). Fechar apenas este alerta não desativa scanning. A exceção do scanner local não altera os detectores do GitHub; novos alertas devem ser avaliados individualmente.

Antes de PROD, configure App Check e observe métricas antes de enforcement, revise quotas e alertas de orçamento se habilitar billing, e considere HTTP referrers limitados a domínios usados após testes de login/refresh. Não reutilize a chave em outros serviços. Reavalie esta conclusão caso as restrições Cloud mudem; o código não consegue verificar automaticamente a configuração do Console.

## Validação desta correção

- `npm test`: 15 testes passaram.
- `npm run test:migration`: 2 testes passaram.
- `npm run test:security`: 4 testes passaram, incluindo credencial extra no mesmo environment.
- `npm run test:rules`: 145 verificações Firestore e 17 Storage passaram.
- `npm run test:transactions`: 10 testes passaram.
- Builds development, dev-hosting e production passaram. Os bundles DEV usam `bem-feito-dev`; PROD contém placeholders, sem a configuração DEV. Nenhuma geração de arquivo foi necessária.
- SDK DEV App/Auth/Firestore/Storage inicializou sem operações de dados. Os providers Angular permanecem iguais, usando somente SDK cliente.
- Scanner sem achados em 120 arquivos locais, incluindo ignorados fora de caches/dependências/build/logs, e 163 blobs textuais do histórico alcançável das branches locais/remotas. Arquivos privados da migração não foram publicados. Não foi encontrada credencial sensível pelos padrões auditados; esse resultado não substitui revisão humana nem cobre objetos Git inacessíveis.
- Build PROD emite aviso de budget inicial: aproximadamente 875 kB frente ao aviso de 700 kB; abaixo do limite de erro de 1,2 MB. Não relacionado à chave.
- Java 25 emitiu avisos/erro de encerramento do runtime Storage após os testes terem passado (exit code 0). O emulador Firestore residual desta execução foi identificado e encerrado antes de repetir transações, que passaram.

## Fontes oficiais

- [API keys for Firebase](https://firebase.google.com/docs/projects/api-keys)
- [Firebase security checklist](https://firebase.google.com/support/guides/security-checklist)
- [Google Cloud API key best practices](https://docs.cloud.google.com/docs/authentication/api-keys-best-practices)
- [GitHub: resolving secret scanning alerts](https://docs.github.com/en/code-security/how-tos/manage-security-alerts/manage-secret-scanning-alerts/resolving-alerts)
