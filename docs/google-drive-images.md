# Imagens no Google Drive — Bem Feito

A integração utiliza Google Drive privado para imagens e Firebase Authentication, Firestore e Hosting para o restante do sistema. A renovação OAuth é processada pelo Cloudflare Worker e documentada em [Google Drive OAuth offline](./google-drive-offline-oauth.md).

## Segurança

- Firebase Auth autentica o usuário. Firestore restringe as operações de negócio a usuários ativos e seus papéis.
- Cloudflare Worker valida a identidade Firebase e a conta Google correspondente antes de emitir access tokens curtos.
- O refresh token permanece criptografado no Cloudflare D1, nunca no navegador, Firestore ou Git.
- O Angular utiliza o access token curto somente em memória para a API do Drive e o Google Picker.
- O Google Drive controla as permissões físicas dos arquivos: compartilhe a pasta privada apenas com contas que precisam dela e com o papel adequado.
- O app não consegue impedir operações feitas diretamente na API por uma pessoa que possua access token e permissão Drive de Editor. Revise as permissões reais ao adicionar usuários.

## Estrutura de pastas

O owner escolhe a pasta privada em **Configurações → Imagens no Google Drive**. A configuração fica no documento `integrations/google-drive` no Firestore, e as quatro subpastas existentes são reutilizadas:

```text
Bem Feito DEV - Imagens/
  products/
  inputs/
  kits/
  additions/
```

O aplicativo não recria pastas por causa da mudança de autenticação. PROD deve ter Firebase, OAuth, Worker, D1, secrets e pasta separados de DEV.

## Imagens

O Firestore armazena referências `{provider:'google-drive', fileId, mimeType, sizeBytes, width, height, modifiedTime}`, nunca os bytes do arquivo.

O navegador valida WebP/PNG/JPEG/GIF/AVIF, aceita arquivos até 12 MB de entrada, reduz a maior dimensão a 1200 px, converte para WebP e limita o arquivo produzido a 3 MB.

Arquivos criados recebem `appProperties` de identidade da entidade. Antes de substituir ou enviar para lixeira, o aplicativo valida esses metadados. A substituição preserva o `fileId`. A visualização usa blob privado e cache de memória com carregamento próximo à viewport.

## Conexão e renovação

1. Cada usuário entra no Bem Feito via Firebase com sua conta Google.
2. Na primeira utilização do novo cliente OAuth, seleciona **Conectar Drive**.
3. O Worker executa Authorization Code + PKCE e guarda a concessão offline criptografada.
4. Nos próximos logins, recupera um token válido ou renova automaticamente sem gesto do usuário.
5. Se a autorização Google for revogada, a interface solicitará uma nova conexão.
6. Na desconexão explícita, a concessão no servidor é revogada; no logout do Firebase, apenas o token curto em memória é descartado.

Os tokens anteriores persistidos em `localStorage`/`sessionStorage` são apagados na inicialização da versão nova.

## Testes mínimos

- Owner e Maria autorizam individualmente e acessam a mesma pasta.
- Após expiração simulada, múltiplas imagens voltam a aparecer sem intervenção.
- Download, upload, substituição com mesmo ID e exclusão continuam corretos.
- Pasta principal e quatro subpastas preservadas, sem migração de dados.
- Google Picker permite escolher a pasta, sem escopos amplos.
- Login com outra conta Google e usuário inativo são rejeitados.
- Logout não revoga o vínculo, enquanto Desconectar faz a revogação explícita.
- Nenhum refresh token ou secret é exposto em navegador, Firestore, URL ou logs.

Para rollout DEV e configuração de ambientes, consulte [o guia de OAuth offline](./google-drive-offline-oauth.md).
