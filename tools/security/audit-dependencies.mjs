import { spawnSync } from 'node:child_process';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const result = spawnSync(npm, ['audit', '--omit=dev', '--json'], {
  encoding: 'utf8',
  maxBuffer: 10 * 1024 * 1024,
});

let report;
try {
  report = JSON.parse(result.stdout || '{}');
} catch {
  process.stderr.write(result.stderr || result.stdout || 'Não foi possível ler o relatório do npm audit.\n');
  process.exit(1);
}

const vulnerabilities = report.vulnerabilities ?? {};
const acceptedUrls = new Set([
  'https://github.com/advisories/GHSA-m9gg-hp2v-232j',
  'https://github.com/advisories/GHSA-f596-whhp-79r4',
]);
const acceptedPackages = new Set([
  '@grpc/grpc-js',
  '@firebase/firestore',
  '@firebase/firestore-compat',
  'firebase',
]);
const memo = new Map();

function isAccepted(name, stack = new Set()) {
  if (memo.has(name)) return memo.get(name);
  const vulnerability = vulnerabilities[name];
  if (!vulnerability || !acceptedPackages.has(name) || stack.has(name)) return false;

  const nextStack = new Set(stack);
  nextStack.add(name);

  const accepted = vulnerability.via.every((entry) => {
    if (typeof entry === 'string') return isAccepted(entry, nextStack);
    return acceptedUrls.has(entry.url);
  });

  memo.set(name, accepted);
  return accepted;
}

const blocked = Object.keys(vulnerabilities).filter((name) => !isAccepted(name));

if (blocked.length) {
  console.error('Dependency audit failed. Vulnerabilities requiring action:');
  for (const name of blocked) {
    const vulnerability = vulnerabilities[name];
    console.error(`- ${name}: ${vulnerability.severity}`);
  }
  process.exit(1);
}

if (!Object.keys(vulnerabilities).length) {
  console.log('Production dependency audit passed with no known vulnerabilities.');
  process.exit(0);
}

const acceptedAdvisories = [...acceptedUrls].filter((url) =>
  Object.values(vulnerabilities).some((vulnerability) =>
    vulnerability.via.some((entry) => typeof entry !== 'string' && entry.url === url),
  ),
);

if (!acceptedAdvisories.length) {
  console.error('Dependency audit returned vulnerabilities outside the documented exception policy.');
  process.exit(1);
}

console.log('Production dependency audit passed.');
console.log('Accepted upstream browser-only Firestore Node transport advisories:');
for (const url of acceptedAdvisories) console.log(`- ${url}`);
console.log('See docs/dependency-security.md for the reviewed rationale and removal condition.');
