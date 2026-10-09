import { createRequire } from 'node:module';
import { GoogleAuth, OAuth2Client } from 'google-auth-library';

// Bootstrap only: reuse the owner's existing local CLI session; never persist/export tokens.
// Runtime workflows use ADC via GitHub OIDC instead of this function.
export function ownerAuth() {
  const modulePath = process.env.FIREBASE_TOOLS_MODULE;
  if (!modulePath) throw new Error('FIREBASE_TOOLS_MODULE must point to an installed firebase-tools package.json');
  const require = createRequire(modulePath);
  const auth = require('./lib/auth.js');
  const account = auth.getProjectDefaultAccount(process.cwd());
  if (!account?.tokens?.refresh_token) throw new Error('Authorized Firebase CLI session unavailable');
  const client = new OAuth2Client();
  client.refreshHandler = async () => {
    const token = await auth.getAccessToken(account.tokens.refresh_token, account.tokens.scopes);
    if (!token?.access_token || !token.expires_at) throw new Error('CLI session refresh failed');
    return { access_token: token.access_token, expiry_date: token.expires_at };
  };
  return new GoogleAuth({ authClient: client });
}

export async function cloudRequest(auth, url, method = 'GET', data) {
  // Do not expose gaxios error objects (they include request authorization headers).
  try { return (await auth.request({ url, method, ...(data === undefined ? {} : { data }) })).data; }
  catch (error) {
    const message = String(error.response?.data?.error?.message ?? '').replace(/[A-Za-z0-9_-]{30,}/g, '[redacted]').slice(0, 250);
    throw new Error(`Cloud API ${method} ${new URL(url).hostname}: HTTP ${error.response?.status ?? 'network'} ${error.response?.data?.error?.status ?? ''} ${message}`);
  }
}
