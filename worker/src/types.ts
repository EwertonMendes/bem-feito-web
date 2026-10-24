export interface Env {
  DB: D1Database;
  ENVIRONMENT: string;
  FIREBASE_PROJECT_ID: string;
  FRONTEND_ORIGIN: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  OAUTH_REDIRECT_URI: string;
  OAUTH_ENABLED: string;
  TOKEN_KEYS: string;
  TOKEN_KEY_VERSION: string;
}
export interface D1Database {
  prepare(sql: string): {
    bind(...values: unknown[]): {
      first<T = Record<string, unknown>>(): Promise<T | null>;
      run(): Promise<{ meta: { changes: number } }>;
      all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
    };
  };
}
export class ApiError extends Error {
  constructor(public readonly status: number, public readonly code: string) { super(code); }
}
export interface Principal { uid: string; email: string; googleSub: string; role: 'owner' | 'operator' | 'viewer'; }
export interface Connection {
  owner_uid: string; google_subject: string; google_email: string; status: string; revision: number;
  encrypted_refresh_token: string | null; encrypted_access_token: string | null;
  access_token_expires_at: number; access_token_version: string | null;
  refresh_lease_id: string | null; refresh_lease_until: number; refresh_retry_after: number;
}
