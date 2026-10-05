import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Exact value + exact path only. Re-audit Cloud restrictions before adding PROD.
// These are public browser configuration keys, not administrative credentials.
// This does not suppress GitHub Secret Scanning. See docs/firebase-key-security.md.
const publicBrowserGoogleApiKeys = new Map([
  ['src/environments/environment.ts', new Set([
    '5f727ceafe724bc42e33acdc94d89cf1324c877debd2ed9282f7fecd12f0511a',
    'c889e85223b68330b79e4b98f4b64a6e448e5c33c92f9864ecb3bc4eda76cf32',
  ])],
]);

const patterns = [
  ['Google API key', /AIza[0-9A-Za-z_-]{35}/g],
  ['Google OAuth client secret', /GOCSPX-[0-9A-Za-z_-]{20,}/g],
  ['Google refresh token', /\b1\/\/[0-9A-Za-z_-]{20,}/g],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g],
  ['GitHub fine-grained token', /\bgithub_pat_[A-Za-z0-9_]{40,}\b/g],
  ['AWS access key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g],
  ['Slack token', /\bxox[baprs]-[0-9A-Za-z-]{20,}\b/g],
  ['Private key', /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/g],
  ['Google service account JSON', /"type"\s*:\s*"service_account"/g],
  ['Stripe secret', /\b(?:sk|rk)_(?:live|test)_[0-9A-Za-z]{16,}\b/g],
  ['OpenAI secret', /\bsk-(?:proj-|svcacct-)?[0-9A-Za-z_-]{20,}\b/g],
  ['Database credential', /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis(?:s)?):\/\/[^\s/:]+:[^\s/@]+@/g],
  ['Credential assignment', /["']?(?:private_key|client_secret|refresh_token|access_token|id_token|FIREBASE_TOKEN|FIREBASE_APPCHECK_DEBUG_TOKEN|appCheckDebugToken|OPENAI_API_KEY|GEMINI_API_KEY|STRIPE_SECRET_KEY|DATABASE_PASSWORD|DB_PASSWORD|ADMIN_TOKEN)["']?\s*[:=]\s*["']([^"'\r\n]+)["']/gi],
];

export function scanContent(file, content) {
  const findings = [];
  for (const [name, pattern] of patterns) {
    for (const match of content.matchAll(pattern)) {
      if (name === 'Google API key' && publicBrowserGoogleApiKeys.get(file)?.has(
        createHash('sha256').update(match[0]).digest('hex'),
      )) continue;
      findings.push({ file, line: content.slice(0, match.index).split(/\r?\n/).length, name });
    }
  }
  return findings;
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
    .split('\0').filter(Boolean);
  const findings = [];
  for (const file of tracked) {
    let content;
    try { content = readFileSync(file, 'utf8'); }
    catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    if (!content.includes('\u0000')) findings.push(...scanContent(file, content));
  }
  if (findings.length) {
    console.error('Potential credentials found (values are never printed):');
    for (const finding of findings) console.error(`- ${finding.name}: ${finding.file}:${finding.line}`);
    process.exitCode = 1;
  } else console.log(`Secret check passed for ${tracked.length} tracked paths.`);
}
