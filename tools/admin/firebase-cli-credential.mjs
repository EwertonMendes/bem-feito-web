import { createRequire } from 'node:module';

// Opt-in reuse of the authorized CLI session. Never log or export credential values.
export function firebaseCliAuth() {
  const require = createRequire(import.meta.url);
  const auth = require('firebase-tools/lib/auth.js');
  const { GoogleAuth, OAuth2Client } = require('google-auth-library');
  const account = auth.getProjectDefaultAccount(process.cwd());
  if (!account?.tokens?.refresh_token) throw new Error('Faça login interativo na Firebase CLI primeiro.');
  const client = new OAuth2Client();
  client.refreshHandler = async () => {
      const token = await auth.getAccessToken(account.tokens.refresh_token, account.tokens.scopes);
      if (!token?.access_token || !token.expires_at) throw new Error('Sessão da Firebase CLI inválida; faça login novamente.');
      return { access_token: token.access_token, expiry_date: token.expires_at };
  };
  return new GoogleAuth({ authClient: client });
}
