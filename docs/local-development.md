# Desenvolvimento local

## 1. Clonar

```bash
git clone https://github.com/EwertonMendes/bem-feito-web.git
cd bem-feito-web
```

## 2. Node

O projeto usa Node 22.22.3.

```bash
nvm use
```

Sem nvm, instale uma versão compatível com o campo `engines` de `package.json`.

## 3. Instalar dependências

```bash
npm install
```

## 4. Configurar Firebase DEV

Copie a configuração do Web App do projeto Firebase de desenvolvimento para:

```text
src/environments/environment.ts
```

Troque todos os placeholders `REPLACE_DEV_...`.

## 5. Rodar Angular

```bash
npm start
```

Acesse `http://localhost:4200`.

## 6. Emuladores opcionais

Para trabalhar sem tocar no Firebase DEV, coloque temporariamente:

```ts
useEmulators: true
```

em `src/environments/environment.ts` e execute em outro terminal:

```bash
npm run firebase:emulators
```

A Emulator UI usa `http://localhost:4000`.

## 7. Build

```bash
npm run build:dev
npm run build:prod
```
