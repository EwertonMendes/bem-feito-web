import { Injectable, computed, inject, signal } from '@angular/core';
import { Auth, onAuthStateChanged } from 'firebase/auth';
import { environment } from '../../../environments/environment';
import { FIREBASE_AUTH } from '../firebase/firebase.providers';
import { ExternalScriptLoaderService } from './external-script-loader.service';

interface OAuthTokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

interface OAuthTokenClient {
  requestAccessToken(options?: { prompt?: string }): void;
}

interface GoogleIdentityWindow {
  google?: {
    accounts?: {
      oauth2?: {
        initTokenClient(config: {
          client_id: string;
          scope: string;
          login_hint?: string;
          callback: (response: OAuthTokenResponse) => void;
          error_callback?: () => void;
        }): OAuthTokenClient;
      };
    };
  };
}

interface DriveTokenSession {
  value: string;
  expiresAt: number;
  firebaseUid: string;
}

interface StoredDriveSession {
  accessToken: string;
  expiresAt: number;
  firebaseUid: string;
  accountEmail?: string;
}

class DriveOAuthError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

export class DriveAuthorizationRequiredError extends Error {
  constructor() {
    super('Conecte o Google Drive para visualizar ou alterar imagens.');
  }
}

@Injectable({ providedIn: 'root' })
export class DriveAuthService {
  private readonly scripts = inject(ExternalScriptLoaderService);
  private readonly firebaseAuth = inject<Auth>(FIREBASE_AUTH);
  private readonly tokenState = signal<DriveTokenSession | null>(null);
  private readonly accountState = signal<string | null>(null);
  private readonly revisionState = signal(0);
  private readonly storageKey = `bem-feito:google-drive:${environment.name}`;
  private pending?: Promise<string>;

  readonly enabled = environment.googleDrive.enabled;
  readonly connected = computed(() => {
    const token = this.tokenState();
    return Boolean(token && token.expiresAt > Date.now() + 60_000);
  });
  readonly accountEmail = this.accountState.asReadonly();
  readonly revision = this.revisionState.asReadonly();

  constructor() {
    this.restoreSession();
    onAuthStateChanged(this.firebaseAuth, (user) => {
      const token = this.tokenState();
      if (!user) {
        if (token) this.invalidate();
        return;
      }
      if (token && token.firebaseUid !== user.uid) this.invalidate();
    });
  }

  currentToken(): string | null {
    const token = this.tokenState();
    if (!token || token.expiresAt <= Date.now() + 60_000) {
      if (token) this.invalidate();
      return null;
    }

    const user = this.firebaseAuth.currentUser;
    if (!user) return null;
    if (token.firebaseUid !== user.uid) {
      this.invalidate();
      return null;
    }
    return token.value;
  }

  requireToken(): string {
    const token = this.currentToken();
    if (!token) throw new DriveAuthorizationRequiredError();
    return token;
  }

  async connect(): Promise<string> {
    if (!this.enabled) throw new Error('A integração com Google Drive ainda não foi configurada.');
    const current = this.currentToken();
    if (current) return current;
    if (this.pending) return this.pending;

    this.pending = this.requestToken('').catch((error) => {
      if (error instanceof DriveOAuthError && ['consent_required', 'interaction_required'].includes(error.code)) {
        return this.requestToken('consent');
      }
      throw error;
    }).finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  }

  setAccountEmail(email: string): void {
    this.accountState.set(email);
    this.persistSession();
  }

  invalidate(): void {
    this.tokenState.set(null);
    this.accountState.set(null);
    this.removeStoredSession();
    this.revisionState.update((value) => value + 1);
  }

  private async requestToken(prompt: string): Promise<string> {
    await this.scripts.load('google-identity-services', 'https://accounts.google.com/gsi/client');
    const google = (window as unknown as GoogleIdentityWindow).google;
    const oauth = google?.accounts?.oauth2;
    if (!oauth) throw new Error('Google Identity Services indisponível.');

    const firebaseUser = this.firebaseAuth.currentUser;
    if (!firebaseUser) throw new Error('Entre no Bem Feito antes de conectar o Google Drive.');

    return new Promise<string>((resolve, reject) => {
      const client = oauth.initTokenClient({
        client_id: environment.googleDrive.clientId,
        scope: 'https://www.googleapis.com/auth/drive.file',
        login_hint: firebaseUser.email ?? undefined,
        callback: (response) => {
          if (!response.access_token) {
            reject(new DriveOAuthError(
              response.error ?? 'oauth_failed',
              response.error_description || 'Autorização do Google Drive não concluída.',
            ));
            return;
          }
          const expiresIn = Math.max(60, Number(response.expires_in ?? 3600));
          this.tokenState.set({
            value: response.access_token,
            expiresAt: Date.now() + expiresIn * 1000,
            firebaseUid: firebaseUser.uid,
          });
          this.persistSession();
          this.revisionState.update((value) => value + 1);
          resolve(response.access_token);
        },
        error_callback: () => reject(new DriveOAuthError('popup_failed', 'A autorização do Google Drive foi cancelada ou bloqueada.')),
      });
      client.requestAccessToken({ prompt });
    });
  }

  private restoreSession(): void {
    try {
      const raw = sessionStorage.getItem(this.storageKey);
      if (!raw) return;
      const stored = JSON.parse(raw) as Partial<StoredDriveSession>;
      if (
        typeof stored.accessToken !== 'string' ||
        typeof stored.expiresAt !== 'number' ||
        typeof stored.firebaseUid !== 'string' ||
        stored.expiresAt <= Date.now() + 60_000
      ) {
        this.removeStoredSession();
        return;
      }

      this.tokenState.set({
        value: stored.accessToken,
        expiresAt: stored.expiresAt,
        firebaseUid: stored.firebaseUid,
      });
      if (typeof stored.accountEmail === 'string') this.accountState.set(stored.accountEmail);
    } catch {
      this.removeStoredSession();
    }
  }

  private persistSession(): void {
    const token = this.tokenState();
    if (!token) return;
    try {
      const stored: StoredDriveSession = {
        accessToken: token.value,
        expiresAt: token.expiresAt,
        firebaseUid: token.firebaseUid,
        accountEmail: this.accountState() ?? undefined,
      };
      sessionStorage.setItem(this.storageKey, JSON.stringify(stored));
    } catch {
      return;
    }
  }

  private removeStoredSession(): void {
    try {
      sessionStorage.removeItem(this.storageKey);
    } catch {
      return;
    }
  }
}
