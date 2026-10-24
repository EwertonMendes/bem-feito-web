import { ApiError, type Env } from './types.ts';
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export interface Tokens {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  expires_in: number;
  token_type: string;
  scope?: string;
}
export async function exchange(env: Env, params: Record<string, string>): Promise<Tokens> {
  if (!env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_CLIENT_ID) throw new ApiError(503, 'oauth_not_configured');
  let response: Response;
  try {
    response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(10000),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ ...params, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET })
    });
  } catch { throw new ApiError(503, 'google_temporarily_unavailable'); }
  if (response.status >= 300 && response.status < 400) throw new ApiError(502, 'google_redirect_blocked');
  const data = await response.json().catch(() => null) as (Tokens & {error?: string}) | null;
  if (!response.ok) {
    if (data?.error === 'invalid_grant' || data?.error === 'invalid_rapt') throw new ApiError(409, 'reconnect_required');
    if (data?.error === 'invalid_client' || data?.error === 'unauthorized_client') throw new ApiError(503, 'oauth_client_invalid');
    if (response.status === 429 || response.status >= 500) throw new ApiError(503, 'google_temporarily_unavailable');
    throw new ApiError(502, 'google_oauth_rejected');
  }
  if (!data || typeof data.access_token !== 'string' || !data.access_token ||
      data.token_type?.toLowerCase() !== 'bearer' ||
      !Number.isFinite(data.expires_in) || data.expires_in < 60 || data.expires_in > 86400 ||
      (data.refresh_token !== undefined && (typeof data.refresh_token !== 'string' || !data.refresh_token))) {
    throw new ApiError(502, 'invalid_google_response');
  }
  return data;
}
