import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { scanContent } from '../security/check-secrets.mjs';

const devPath = 'src/environments/environment.ts';
const dev = readFileSync(devPath, 'utf8');
const otherGoogleKey = 'AI' + 'za' + 'X'.repeat(35);

test('audited DEV config is public; the exception does not cover other paths', () => {
  assert.deepEqual(scanContent(devPath, dev), []);
  assert.ok(scanContent('src/environments/environment.production.ts', dev).length);
});
test('an additional Google key in the same file is still detected', () => {
  assert.equal(scanContent(devPath, `${dev}\nconst extra = '${otherGoogleKey}';`).length, 1);
});
test('sensitive credentials are detected even beside the public Firebase config', () => {
  const examples = [
    '-----BEGIN ' + 'PRIVATE KEY-----',
    JSON.stringify({ type: ['service', 'account'].join('_') }),
    ['GOCSPX', 'x'.repeat(25)].join('-'),
    ['ghp', 'x'.repeat(36)].join('_'),
    ['sk', 'live', 'x'.repeat(24)].join('_'),
    ['sk', 'proj', 'x'.repeat(30)].join('-'),
    ['1', '', 'x'.repeat(30)].join('/'),
    ['postgresql:', '', 'user:pass@localhost/db'].join('/'),
    JSON.stringify({ [['FIREBASE', 'APPCHECK', 'DEBUG', 'TOKEN'].join('_')]: '00000000-'.repeat(4) + '00000000' }),
    JSON.stringify({ [['client', 'secret'].join('_')]: 'synthetic-fixture' }),
    JSON.stringify({ [['refresh', 'token'].join('_')]: 'synthetic-fixture' }),
    JSON.stringify({ [['ADMIN', 'TOKEN'].join('_')]: 'synthetic-fixture' }),
  ];
  for (const example of examples) {
    const findings = scanContent(devPath, `${dev}\n${example}`);
    assert.ok(findings.length);
    assert.ok(findings.every((finding) => !('value' in finding)));
  }
});
test('reports multiple occurrences and their lines without values', () => {
  const findings = scanContent('other.ts', `${otherGoogleKey}\n${otherGoogleKey}`);
  assert.deepEqual(findings.map(({ line }) => line), [1, 2]);
});
