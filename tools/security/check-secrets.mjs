import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const patterns = [
  ['Google API key', /AIza[0-9A-Za-z_-]{35}/],
  ['Google OAuth client secret', /GOCSPX-[0-9A-Za-z_-]{20,}/],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{30,}\b/],
  ['GitHub fine-grained token', /\bgithub_pat_[A-Za-z0-9_]{40,}\b/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['Slack token', /\bxox[baprs]-[0-9A-Za-z-]{20,}\b/],
  ['Private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['Google service account JSON', /"type"\s*:\s*"service_account"/],
];

const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);

const findings = [];

for (const file of tracked) {
  let content;
  try {
    content = readFileSync(file, 'utf8');
  } catch {
    continue;
  }

  if (content.includes('\u0000')) continue;

  for (const [name, pattern] of patterns) {
    const match = pattern.exec(content);
    if (!match) continue;

    const line = content.slice(0, match.index).split(/\r?\n/).length;
    findings.push({ file, line, name });
  }
}

if (findings.length) {
  console.error('Potential credentials found in tracked files:');
  for (const finding of findings) {
    console.error(`- ${finding.name}: ${finding.file}:${finding.line}`);
  }
  console.error('Matched credential values are intentionally not printed.');
  process.exit(1);
}

console.log(`Secret check passed for ${tracked.length} tracked files.`);
