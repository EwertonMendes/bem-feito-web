import { GoogleAuth } from 'google-auth-library';
import { spawnSync } from 'node:child_process';

const id = process.env.MIGRATION_SNAPSHOT_ID;
if (!id || !/^[A-Za-z0-9_-]+$/.test(id)) throw new Error('Snapshot ID ausente.');
const client = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/drive.readonly'] });
const token = await client.getAccessToken();
if (!token) throw new Error('Credencial de serviço indisponível.');
const url = 'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(id);
async function access(suffix) {
  const response = await fetch(url + suffix, { headers: { Authorization: 'Bearer ' + token } });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const reason = payload.error?.errors?.[0]?.reason ?? payload.error?.status ?? 'unknown';
    const message = String(payload.error?.message ?? '').replace(/[A-Za-z0-9_-]{22,}/g, '[redacted]').slice(0, 220);
    throw new Error('Private Google Drive export HTTP ' + response.status + ' (' + reason + '): ' + message);
  }
  return response;
}
const metadata = await (await access('?fields=id,name,mimeType')).json();
if (metadata.mimeType !== 'application/vnd.google-apps.spreadsheet') throw new Error('Fonte não é uma planilha nativa.');
if (process.argv.includes('--preflight')) {
  console.log('Arquivo temporário acessível pelo Google Drive. ID privado verificado.');
  process.exit(0);
}
const type = encodeURIComponent('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
const binary = Buffer.from(await (await access('/export?mimeType=' + type)).arrayBuffer());
if (binary.length < 300 || binary.length > 25_000_000) throw new Error('Arquivo de exportação XLSX inválido.');
const result = spawnSync('python3', ['tools/migration/convert-xlsx.py', id, metadata.name], {
  input: binary, maxBuffer: 1024 * 1024 * 10, encoding: 'utf8',
});
if (result.status !== 0) throw new Error('Conversão XLSX falhou: ' + String(result.stderr).slice(0, 500));
console.log(result.stdout.trim());
