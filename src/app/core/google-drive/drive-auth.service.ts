import { Injectable, computed, inject, signal } from '@angular/core';
import { environment } from '../../../environments/environment';
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
          callback: (response: OAuthTokenResponse) => void;
          error_callback?: () => void;
        }): OAuthTokenClient;
      };
    };
  };
}

export class DriveAuthorizationRequiredError extends Error {
  constructor() {
    super('Conecte o Google Drive para visualizar ou alterar imagens.');
  }
}

@Injectable({ providedIn: 'root' })
export class DriveAuthService {
  private readonly scripts = inject(ExternalScriptLoaderService);
  private readonly tokenState = signal<{ value: string; expiresAt: number } | null>(null);
  private readonly accountState = signal<string | null>(null);
  private readonly revisionState = signal(0);
  private pending?: Promise<string>;

  readonly enabled = environment.googleDrive.enabled;
  readonly connected = computed(() => {
    const token = this.tokenState();
    return Boolean(token && token.expiresAt > Date.now() + 60_000);
  });
  readonly accountEmail = this.accountState.asReadonly();
  readonly revision = this.revisionState.asReadonly();

  currentToken(): string | null {
    const token = this.tokenState();
    if (!token || token.expiresAt <= Date.now() + 60_000) {
      if (token) this.invalidate();
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

    this.pending = this.requestToken('').catch(() => this.requestToken('consent')).finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  }

  setAccountEmail(email: string): void {
    this.accountState.set(email);
  }

  invalidate(): void {
    this.tokenState.set(null);
    this.accountState.set(null);
    this.revisionState.update((value) => value + 1);
  }

  private async requestToken(prompt: string): Promise<string> {
    await this.scripts.load('google-identity-services', 'https://accounts.google.com/gsi/client');
    const google = (window as unknown as GoogleIdentityWindow).google;
    const oauth = google?.accounts?.oauth2;
    if (!oauth) throw new Error('Google Identity Services indisponível.');

    return new Promise<string>((resolve, reject) => {
      const client = oauth.initTokenClient({
        client_id: environment.googleDrive.clientId,
        scope: 'https://www.googleapis.com/auth/drive.file',
        callback: (response) => {
          if (!response.access_token) {
            reject(new Error(response.error_description || response.error || 'Autorização do Google Drive não concluída.'));
            return;
          }
          const expiresIn = Math.max(60, Number(response.expires_in ?? 3600));
          this.tokenState.set({ value: response.access_token, expiresAt: Date.now() + expiresIn * 1000 });
          this.revisionState.update((value) => value + 1);
          resolve(response.access_token);
        },
        error_callback: () => reject(new Error('A autorização do Google Drive foi cancelada ou bloqueada.')),
      });
      client.requestAccessToken({ prompt });
    });
  }
}
