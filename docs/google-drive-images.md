# Imagens no Google Drive — armazenamento central do Bem Feito

## Como funciona

O Google Drive do Ewerton é o armazenamento físico central do catálogo. Maria e outros usuários autorizados entram no Bem Feito pelo Firebase Auth sem autorizar suas contas Google Drive. O Cloudflare Worker valida cada identidade/role Firebase e só então acessa as imagens pela conexão OAuth do proprietário, cujas credenciais continuam criptografadas no Cloudflare D1, isoladas por ambiente.

A conta proprietária é fixa na configuração STORAGE_OWNER_EMAIL, atualmente ewertonmendes9@gmail.com; não é escolhida pelo usuário que se conecta, nem pelo primeiro owner. Maria não recebe o access token ou refresh token do Ewerton, nem mesmo temporariamente. O browser envia apenas seu próprio Firebase ID token.

## Estrutura e migração

O documento Firestore integrations/google-drive preserva a raiz e as subpastas products, inputs, kits e additions. Imagens existentes permanecem com o mesmo fileId nos documentos comerciais. Não há migração, duplicação, alteração de ID ou mudança das pastas Google Drive. DEV e PROD têm seus próprios Firebase, Cloudflare Worker, D1 e conexão OAuth.

## Controles de segurança

- viewer: leitura privada; operator e owner: também upload, substituição e exclusão de imagens de cadastros.
- O Worker valida o Firebase JWT, perfil ativo, role e origem HTTP. A leitura do documento integrations/google-drive usa o próprio Firebase JWT de quem solicitou, sem acesso administrativo Firestore.
- Leituras somente de imagens WebP marcadas com appProperties.app=bem-feito, entityType e entityId válidos e parent situado exatamente nas subpastas configuradas; máximo de 3 MB.
- Upload limitado a 3 MB, valida assinatura WebP, exige entidade Firestore existente sem imagem, nome e pasta construídos no Worker.
- Substituição: exige que o documento da entidade ainda referencie aquele fileId, além de comparar os metadados do Google Drive.
- Exclusão: aceita a referência igual ou vazia (a interface retira a referência primeiro), mas rejeita se a entidade já aponta para outra imagem.
- Tokens de proprietário, endereços do Google e segredos nunca são entregues em respostas ao navegador. Erros são neutros e nenhuma foto fica pública por padrão.

## Processo de implantação

1. CI completa verde (Node Worker, Angular, testes, security scan, build DEV/PROD).
2. Merge apenas de PR revisada; confirmar que OAuth do Ewerton está conectado no D1 de DEV.
3. Publicar Worker DEV a partir da master com workflow protegido, antes de validar o frontend DEV.
4. Testar com duas contas, incluindo Maria: imagens existentes, adicionar foto, substituir mantendo fileId, remover foto, mobile, papel viewer, cache, expiração e reconnect.
5. Após a homologação, promover o Worker e Hosting PROD via workflows manuais protegidos, com revisão humana. Não migrar, sobrescrever ou copiar dados entre ambientes.
6. Conferir que imagens novas no Drive PROD pertencem ao Ewerton.

Se Ewerton desconectar o OAuth, as imagens ficam indisponíveis até ele reconectar a própria conta em Configurações. Maria não precisa escolher qualquer pasta no Picker. O compartilhamento privado da pasta pode continuar, mas não é necessário para a leitura/escrita dentro do aplicativo. Nunca habilitar o compartilhamento público.
