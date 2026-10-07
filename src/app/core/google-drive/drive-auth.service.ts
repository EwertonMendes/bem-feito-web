import { Injectable, computed, inject, signal } from '@angular/core';
import { Auth, onAuthStateChanged } from 'firebase/auth';
import { environment } from '../../../environments/environment';
import { FIREBASE_AUTH } from '../firebase/firebase.providers';
import { ExternalScriptLoaderService } from './external-script-loader.service';

const GOOGLE_IDENTITY_SCRIPT_ID = 'google-identity-services';
const GOOGLE_IDENTITY_SCRIPT_URL = 'https://accounts.google.com/gsi/client';
const TOKEN_EXPIRY_SKEW_MS = 5 * 60_000;

interface OAuthTokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

interface OAuthTokenClient {
  requestAccessToken(options?: { prompt?: string }): void;
}

interface GoogleOAuth {
  initTokenClient(config: {
    client_id: string;
    scope: string;
    login_hint?: string;
    callback: (response: OAuthTokenResponse) => void;
    error_callback?: () => void;
  }): OAuthTokenClient;
}

interface GoogleIdentityWindow {
  google?: {
    accounts?: {
      oauth2?: GoogleOAuth;
    };
  };
}

interface DriveTokenSession {
  value: string;
  expiresAt: number;
  firebaseUid: string;
}

interface StoredDriveTokenSession {
  accessToken: string;
  expiresAt: number;
  firebaseUid: string;
  accountEmail?: string;
}

interface StoredDriveGrant {
  firebaseUid: string;
  accountEmail?: string;
  grantedAt: number;
}

class DriveOAuthError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

export class DriveAuthorizationRequiredError extends Error {
  constructor() {
    super('Confirme o acesso ao Google Drive para continuar.');
  }
}

@Injectable({ providedIn: 'root' })
export class DriveAuthService {
  private readonly scripts = inject(ExternalScriptLoaderService);
  private readonly firebaseAuth = inject<Auth>(FIREBASE_AUTH);
  private readonly tokenState = signal<DriveTokenSession | null>(null);
  private readonly grantState = signal<StoredDriveGrant | null>(null);
  private readonly accountState = signal<string | null>(null);
  private readonly firebaseUidState = signal<string | null | undefined>(undefined);
  private readonly revisionState = signal(0);
  private readonly tokenStorageKey = `bem-feito:google-drive:${environment.name}`;
  private readonly grantStorageKey = `bem-feito:google-drive-grant:${environment.name}`;
  private pending?: Promise<string>;
  private scriptReady?: Promise<void>;

  readonly enabled = environment.googleDrive.enabled;
  readonly linked = computed(() => {
    const grant = this.grantState();
    const firebaseUid = this.firebaseUidState();
    return Boolean(grant && firebaseUid && grant.firebaseUid === firebaseUid);
  });
  readonly connected = computed(() => {
    const token = this.tokenState();
    const firebaseUid = this.firebaseUidState();
    return Boolean(
      token &&
      firebaseUid &&
      token.firebaseUid === firebaseUid &&
      token.expiresAt > Date.now() + TOKEN_EXPIRY_SKEW_MS
    );
  });
  readonly accountEmail = this.accountState.asReadonly();
  readonly revision = this.revisionState.asReadonly();

  constructor() {
    this.restoreState();
    if (this.enabled) void this.prepare().catch(() => undefined);

    onAuthStateChanged(this.firebaseAuth, (user) => {
      this.firebaseUidState.set(user?.uid ?? null);

      if (!user) {
        this.endSession();
        return;
      }

      const token = this.tokenState();
      if (token && token.firebaseUid !== user.uid) this.clearAccessToken();

      const grant = this.grantState();
      if (grant && grant.firebaseUid !== user.uid) this.clearGrant();

      const restoredToken = this.tokenState();
      if (restoredToken?.firebaseUid === user.uid && !this.grantState()) {
        this.rememberGrant(user.uid, this.accountState() ?? undefined);
      }
    });
  }

  prepare(): Promise<void> {
    if (!this.enabled) return Promise.resolve();
    if (this.scriptReady) return this.scriptReady;

    const load = this.scripts
      .load(GOOGLE_IDENTITY_SCRIPT_ID, GOOGLE_IDENTITY_SCRIPT_URL)
      .catch((error) => {
        this.scriptReady = undefined;
        throw error;
      });
    this.scriptReady = load;
    return load;
  }

  currentToken(): string | null {
    const token = this.tokenState();
    if (!token) return null;

    const firebaseUid = this.firebaseUidState();
    if (!firebaseUid) return null;

    if (token.firebaseUid !== firebaseUid) {
      this.disconnect();
      return null;
    }

    if (token.expiresAt <= Date.now() + TOKEN_EXPIRY_SKEW_MS) {
      this.expireAccessToken();
      return null;
    }

    return token.value;
  }

  requireToken(): string {
    const token = this.currentToken();
    if (!token) throw new DriveAuthorizationRequiredError();
    return token;
  }

  connect(): Promise<string> {
    if (!this.enabled) return Promise.reject(new Error('A integração com Google Drive ainda não foi configurada.'));

    const current = this.currentToken();
    if (current) return Promise.resolve(current);
    if (this.pending) return this.pending;

    const initialPrompt = this.linked() ? '' : 'consent';
    const request = this.requestToken(initialPrompt).catch((error) => {
      if (
        initialPrompt === '' &&
        error instanceof DriveOAuthError &&
        ['consent_required', 'interaction_required'].includes(error.code)
      ) {
        return this.requestToken('consent');
      }
      throw error;
    });

    this.pending = request.finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  }

  setAccountEmail(email: string): void {
    const normalized = email.trim();
    this.accountState.set(normalized || null);

    const grant = this.grantState();
    if (grant) {
      this.grantState.set({ ...grant, accountEmail: normalized || undefined });
      this.persistGrant();
    }
    this.persistTokenSession();
  }

  expireAccessToken(): void {
    this.clearAccessToken();
  }

  private endSession(): void {
    const hadSessionData = Boolean(this.tokenState() || this.grantState() || this.accountState());
    this.clearAccessToken();
    if (hadSessionData) this.revisionState.update((value) => value + 1);
  }

  disconnect(): void {
    const hadIdentity = Boolean(this.tokenState() || this.grantState() || this.accountState());
    this.clearAccessToken();
    this.clearGrant(false);
    if (hadIdentity) this.revisionState.update((value) => value + 1);
  }

  private requestToken(prompt: string): Promise<string> {
    const oauth = this.oauth();
    if (oauth) return this.startTokenRequest(oauth, prompt);

    return this.prepare().then(() => {
      const loadedOAuth = this.oauth();
      if (!loadedOAuth) throw new Error('Google Identity Services indisponível.');
      return this.startTokenRequest(loadedOAuth, prompt);
    });
  }

  private startTokenRequest(oauth: GoogleOAuth, prompt: string): Promise<string> {
    const firebaseUser = this.firebaseAuth.currentUser;
    if (!firebaseUser) return Promise.reject(new Error('Entre no Bem Feito antes de conectar o Google Drive.'));

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
          this.rememberGrant(firebaseUser.uid, this.accountState() ?? undefined);
          this.persistTokenSession();
          resolve(response.access_token);
        },
        error_callback: () => reject(
          new DriveOAuthError('popup_failed', 'A autorização do Google Drive foi cancelada ou bloqueada.'),
        ),
      });
      client.requestAccessToken({ prompt });
    });
  }

  private oauth(): GoogleOAuth | undefined {
    return (window as unknown as GoogleIdentityWindow).google?.accounts?.oauth2;
  }

  private rememberGrant(firebaseUid: string, accountEmail?: string): void {
    const current = this.grantState();
    const identityChanged = !current || current.firebaseUid !== firebaseUid;
    const grant: StoredDriveGrant = {
      firebaseUid,
      accountEmail: accountEmail ?? current?.accountEmail,
      grantedAt: current?.firebaseUid === firebaseUid ? current.grantedAt : Date.now(),
    };

    this.grantState.set(grant);
    if (grant.accountEmail) this.accountState.set(grant.accountEmail);
    this.persistGrant();

    if (identityChanged) this.revisionState.update((value) => value + 1);
  }

  private restoreState(): void {
    this.restoreGrant();
    this.restoreTokenSession();

    const token = this.tokenState();
    if (token && !this.grantState()) {
      this.rememberGrant(token.firebaseUid, this.accountState() ?? undefined);
    }
  }

  private restoreGrant(): void {
    try {
      const raw = localStorage.getItem(this.grantStorageKey);
      if (!raw) return;
      const stored = JSON.parse(raw) as Partial<StoredDriveGrant>;
      if (typeof stored.firebaseUid !== 'string') {
        localStorage.removeItem(this.grantStorageKey);
        return;
      }

      const grant: StoredDriveGrant = {
        firebaseUid: stored.firebaseUid,
        accountEmail: typeof stored.accountEmail === 'string' ? stored.accountEmail : undefined,
        grantedAt: typeof stored.grantedAt === 'number' ? stored.grantedAt : Date.now(),
      };
      this.grantState.set(grant);
      if (grant.accountEmail) this.accountState.set(grant.accountEmail);
    } catch {
      try {
        localStorage.removeItem(this.grantStorageKey);
      } catch {
        return;
      }
    }
  }

  private restoreTokenSession(): void {
    try {
      const raw = sessionStorage.getItem(this.tokenStorageKey);
      if (!raw) return;
      const stored = JSON.parse(raw) as Partial<StoredDriveTokenSession>;

      if (
        typeof stored.accessToken !== 'string' ||
        typeof stored.expiresAt !== 'number' ||
        typeof stored.firebaseUid !== 'string'
      ) {
        this.removeStoredToken();
        return;
      }

      if (stored.expiresAt <= Date.now() + TOKEN_EXPIRY_SKEW_MS) {
        this.removeStoredToken();
        if (!this.grantState()) {
          this.rememberGrant(
            stored.firebaseUid,
            typeof stored.accountEmail === 'string' ? stored.accountEmail : undefined,
          );
        } else if (typeof stored.accountEmail === 'string' && !this.accountState()) {
          this.accountState.set(stored.accountEmail);
        }
        return;
      }

      this.tokenState.set({
        value: stored.accessToken,
        expiresAt: stored.expiresAt,
        firebaseUid: stored.firebaseUid,
      });
      if (typeof stored.accountEmail === 'string') this.accountState.set(stored.accountEmail);
    } catch {
      this.removeStoredToken();
    }
  }

  private persistTokenSession(): void {
    const token = this.tokenState();
    if (!token) return;

    try {
      const stored: StoredDriveTokenSession = {
        accessToken: token.value,
        expiresAt: token.expiresAt,
        firebaseUid: token.firebaseUid,
        accountEmail: this.accountState() ?? undefined,
      };
      sessionStorage.setItem(this.tokenStorageKey, JSON.stringify(stored));
    } catch {
      return;
    }
  }

  private persistGrant(): void {
    const grant = this.grantState();
    if (!grant) return;

    try {
      localStorage.setItem(this.grantStorageKey, JSON.stringify(grant));
    } catch {
      return;
    }
  }

  private clearAccessToken(): void {
    this.tokenState.set(null);
    this.removeStoredToken();
  }

  private clearGrant(incrementRevision = true): void {
    const hadGrant = Boolean(this.grantState() || this.accountState());
    this.grantState.set(null);
    this.accountState.set(null);
    try {
      localStorage.removeItem(this.grantStorageKey);
    } catch {
      // Storage is optional; in-memory state is already cleared.
    }
    if (hadGrant && incrementRevision) this.revisionState.update((value) => value + 1);
  }

  private removeStoredToken(): void {
    try {
      sessionStorage.removeItem(this.tokenStorageKey);
    } catch {
      return;
    }
  }
}
