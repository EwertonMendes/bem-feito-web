import { readFile, writeFile } from 'node:fs/promises';

const path = 'src/environments/environment.ts';
let source = await readFile(path, 'utf8');
const replacements = [
  ['projectId: "bem-feito-dev"', 'projectId: "demo-bem-feito"'],
  ['useEmulators: false', 'useEmulators: true'],
  ['enabled: true', 'enabled: false'],
];
for (const [from, to] of replacements) {
  if (!source.includes(from)) throw new Error('Cannot isolate emulator environment: ' + from);
  source = source.replace(from, to);
}
await writeFile(path, source);
console.log('E2E uses isolated Firebase emulators (demo-bem-feito).');
