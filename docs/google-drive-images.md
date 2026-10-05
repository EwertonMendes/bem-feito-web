# Imagens no Google Drive

Esta branch substitui a dependência de Firebase Storage por uma integração privada com Google Drive. Firebase continua responsável por Authentication, Firestore e Hosting.

## Modelo de segurança

A pasta de imagens permanece privada e deve ser compartilhada somente com as contas que realmente usam o Bem Feito. Cada conta precisa ter permissão de Editor para adicionar, substituir ou remover imagens.

O app usa autorização OAuth incremental com o escopo `https://www.googleapis.com/auth/drive.file`. Firebase Auth e Drive OAuth são responsabilidades separadas:

- Firebase Auth decide se a pessoa entra no Bem Feito.
- Firestore `users/{uid}` e as roles decidem o que ela pode fazer no sistema.
- Google Drive decide se a conta Google pode acessar fisicamente a pasta e os arquivos.
- O app confere se o e-mail autorizado no Drive é o mesmo e-mail autenticado no Firebase.

O access token fica em memória e também é espelhado temporariamente em `sessionStorage` somente para sobreviver a recarregamentos da mesma aba. Ele é curto, limitado a `drive.file`, removido quando expira, quando o Firebase faz logout, quando a conta Firebase muda ou quando o Drive devolve `401`. Nunca grave refresh token, client secret, cookies ou credenciais de service account em Firestore, localStorage, IndexedDB, Git ou logs.

OAuth Client ID, Picker API Key restrita e Cloud Project Number são identificadores públicos de uma SPA. A API Key deve ser limitada aos origins e APIs necessários.

## Preparar Google Cloud DEV

Use o projeto Google Cloud associado ao ambiente DEV ou um projeto dedicado à integração DEV.

1. Habilite **Google Drive API**.
2. Habilite **Google Picker API**.
3. Configure a tela de consentimento OAuth.
4. Se o app estiver em modo Testing, adicione as contas que testarão o Drive como test users.
5. Crie um OAuth Client ID do tipo **Web application**.
6. Configure os Authorized JavaScript origins:
   - `http://localhost:4200`
   - `https://bem-feito-dev.web.app`
7. Crie uma API Key dedicada ao Picker.
8. Restrinja a API Key por HTTP referrer aos origins do Bem Feito e restrinja a chave à Google Picker API.
9. Copie o número numérico do Google Cloud Project.

Em `src/environments/environment.ts`, preencha somente os valores públicos:

```ts
googleDrive: {
  enabled: true,
  clientId: '...apps.googleusercontent.com',
  pickerApiKey: '...',
  cloudProjectNumber: '123456789'
}
```

Nunca adicione `client_secret` ao Angular.

## Preparar a pasta

Crie uma pasta exclusiva para o ambiente, por exemplo:

```text
Bem Feito DEV - Imagens
```

Mantenha-a privada. Compartilhe como **Editor** com cada pessoa que deve trabalhar com imagens.

Depois:

1. Entre no Bem Feito com um usuário `owner`.
2. Abra **Configurações**.
3. No card **Imagens no Google Drive**, clique em **Configurar pasta**.
4. Autorize o escopo Drive quando o Google solicitar.
5. Selecione a pasta criada.

O app cria ou reutiliza as subpastas:

```text
products
inputs
kits
additions
```

A configuração global fica em `integrations/google-drive`. Usuários ativos podem lê-la; somente `owner` pode criá-la ou alterá-la.

Para outro usuário, como Maria:

1. Compartilhe a mesma pasta com o e-mail Google dela como Editor.
2. Cadastre/ative o perfil dela no Firebase normalmente.
3. Ela entra no Bem Feito.
4. Em Configurações, clica **Conectar Drive**.
5. Se o Picker aparecer, seleciona exatamente a mesma pasta já configurada.

## Imagens

O Firestore armazena somente uma referência:

```json
{
  "image": {
    "provider": "google-drive",
    "fileId": "...",
    "mimeType": "image/webp",
    "sizeBytes": 123456,
    "width": 800,
    "height": 600,
    "modifiedTime": "2026-10-05T20:00:00.000Z"
  }
}
```

O arquivo não é armazenado no Firestore.

Antes do upload, o navegador:

- aceita WebP, PNG, JPEG, GIF ou AVIF;
- limita o arquivo original a 12 MB;
- reduz a maior dimensão para no máximo 1200 px;
- converte para WebP;
- limita a saída a 3 MB.

Arquivos criados pelo app recebem `appProperties` com app, tipo de entidade e ID. Antes de substituir ou mandar uma imagem para a lixeira, o app confere esses metadados. Substituição mantém o mesmo `fileId`; remoção limpa a referência do Firestore e move o arquivo para a lixeira do Drive.

A leitura usa blob privado, cache em memória e carregamento próximo ao viewport.

## Sessão OAuth

O consentimento `drive.file` não deve aparecer a cada uso enquanto a concessão continuar válida.

Para evitar que um simples F5 derrube as imagens, o access token atual é mantido em `sessionStorage` até a expiração. No reload da mesma aba, o app restaura o token, valida novamente a conta Google e a pasta configurada e só então libera a leitura das imagens.

O token não é mantido após logout, troca de conta, expiração, resposta `401` do Drive ou encerramento da sessão da aba. Como o fluxo client-side do Google não entrega um refresh token durável para a SPA, depois da expiração ainda pode ser necessário clicar em **Conectar Drive**. Esse botão reutiliza o consentimento existente sempre que possível e usa o e-mail Firebase como `login_hint` para evitar seleção de conta desnecessária.

## Testes recomendados

Teste com duas contas reais no DEV:

- owner configura a pasta;
- ambos conseguem visualizar as mesmas imagens;
- ambos conseguem enviar/substituir imagens quando a role do Bem Feito permite;
- viewer não deve ganhar poderes de operação no app;
- substituir mantém o `fileId`;
- remover apaga a referência e manda o arquivo para a lixeira;
- remover o compartilhamento de uma conta no Drive deve impedir o acesso aos arquivos;
- tentar autorizar outra conta Google que não corresponda ao Firebase deve ser rejeitado;
- nenhum token deve aparecer em Firestore, `localStorage`, IndexedDB ou Git; durante a sessão atual, apenas o access token curto pode existir em `sessionStorage`.

PROD deve usar OAuth configuration e pasta separados do DEV.
