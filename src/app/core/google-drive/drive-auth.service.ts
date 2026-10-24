import { Injectable, computed, inject, signal } from '@angular/core';
import { Auth, onAuthStateChanged } from 'firebase/auth';
import { environment } from '../../../environments/environment';
import { FIREBASE_AUTH } from '../firebase/firebase.providers';

const EXPIRY_MARGIN = 60_000;
interface CachedToken { value: string; expiresAt: number; uid: string; version: string; }
interface TokenReply { accessToken: string; expiresAt: number; email: string; version: string; }
interface BrokerError { error?: { code?: string }; }

export class DriveAuthorizationRequiredError extends Error {
  constructor() { super('Conecte sua conta Google Drive para carregar as imagens.'); }
}
export class DriveRedirectStartedError extends Error {
  constructor() { super('Redirecionando para autorizar o Google Drive.'); }
}

@Injectable({ providedIn: 'root' })
export class DriveAuthService {
  private readonly firebaseAuth = inject<Auth>(FIREBASE_AUTH);
  private readonly tokenState = signal<CachedToken | null>(null);
  private readonly accountState = signal<string | null>(null);
  private readonly linkedState = signal(false);
  private readonly uidState = signal<string | null>(null);
  private readonly revisionState = signal(0);
  private tokenPending?: Promise<string>;
  private startPending?: Promise<never>;
  private authorizationDeniedUid: string | null = null;
  private readonly legacyTokenKey = `bem-feito:google-drive:${environment.name}`;
  private readonly legacyGrantKey = `bem-feito:google-drive-grant:${environment.name}`;
  readonly enabled = environment.googleDrive.enabled;
  readonly linked = this.linkedState.asReadonly();
  readonly connected = computed(() => {
    const token = this.tokenState();
    return Boolean(token && this.uidState() === token.uid && token.expiresAt > Date.now()+EXPIRY_MARGIN);
  });
  readonly accountEmail = this.accountState.asReadonly();
  readonly revision = this.revisionState.asReadonly();

  constructor() {
    this.removeLegacyCredentials();
    onAuthStateChanged(this.firebaseAuth, (user) => {
      if (this.uidState() !== (user?.uid ?? null)) {
        this.uidState.set(user?.uid ?? null);
        this.reset();
      }
    });
  }
  prepare(): Promise<void> { return Promise.resolve(); }

  currentToken(): string | null {
    const uid = this.firebaseAuth.currentUser?.uid;
    const cached = this.tokenState();
    if (!uid || !cached || cached.uid !== uid) return null;
    if (cached.expiresAt <= Date.now()+EXPIRY_MARGIN) {
      this.expireAccessToken();
      return null;
    }
    return cached.value;
  }

  async accessToken(force = false): Promise<string> {
    if (!this.enabled) throw new Error('Google Drive desativado neste ambiente.');
    const user = this.firebaseAuth.currentUser;
    if (!user) throw new Error('Entre no Bem Feito para acessar o Google Drive.');
    if (this.authorizationDeniedUid === user.uid) throw new DriveAuthorizationRequiredError();
    if (!force) {
      const current = this.currentToken();
      if (current) return current;
    }
    if (this.tokenPending) return this.tokenPending;
    const uid = user.uid;
    this.tokenPending = (async () => {
      const result = await this.call<TokenReply>('/drive/token', 'POST');
      if (this.firebaseAuth.currentUser?.uid !== uid) throw new Error('Sua sessão foi alterada.');
      if (!result.accessToken || !result.version || !Number.isFinite(result.expiresAt) || result.expiresAt <= Date.now()+EXPIRY_MARGIN) {
        throw new Error('A credencial recebida do Drive é inválida.');
      }
      this.tokenState.set({uid,value:result.accessToken,expiresAt:result.expiresAt,version:result.version});
      this.accountState.set(result.email);
      this.linkedState.set(true);
      this.authorizationDeniedUid = null;
      return result.accessToken;
    })().finally(() => { this.tokenPending = undefined; });
    return this.tokenPending;
  }

  async connect(): Promise<string> {
    try {
      return await this.accessToken();
    } catch (error) {
      if (!(error instanceof DriveAuthorizationRequiredError)) throw error;
      if (!this.startPending) this.startPending = this.startOAuth().finally(() => { this.startPending = undefined; });
      return this.startPending;
    }
  }

  versionForToken(token: string): string | null {
    const current = this.tokenState();
    return current?.value === token ? current.version : null;
  }

  async rejectAccessToken(version: string | null = this.tokenState()?.version ?? null): Promise<void> {
    if (!version) return;
    // A 401 for a superseded request must never evict the newer cache entry.
    if (this.tokenState()?.version === version) this.expireAccessToken();
    await this.call('/drive/token/reject','POST',{version});
  }

  async revoke(): Promise<void> {
    await this.call('/drive/disconnect','POST');
    this.reset();
  }

  // Local-only reset: never revoke a server-side grant merely because the browser logged out.
  disconnect(): void { this.reset(); }
  setAccountEmail(email: string): void { this.accountState.set(email.trim() || null); }
  expireAccessToken(): void { this.tokenState.set(null); }

  private async startOAuth(): Promise<never> {
    const reply = await this.call<{launchUrl:string}>('/oauth/drive/start','POST');
    const url = new URL(reply.launchUrl);
    if (url.origin !== environment.googleDrive.workerUrl || url.pathname !== '/oauth/drive/launch') {
      throw new Error('A URL de autorização recebida não é confiável.');
    }
    window.location.assign(url.toString());
    throw new DriveRedirectStartedError();
  }

  private async call<T>(path: string, method: 'GET'|'POST', payload?: unknown): Promise<T> {
    const user = this.firebaseAuth.currentUser;
    if (!user) throw new Error('A sessão do Bem Feito expirou.');
    let response: Response | undefined;
    for (let attempt=0;attempt<2;attempt++) {
      const token = await user.getIdToken(attempt === 1);
      response = await fetch(environment.googleDrive.workerUrl+path,{
        method, headers:{Authorization:'Bearer '+token,...(payload===undefined?{}:{'Content-Type':'application/json'})},
        ...(payload===undefined?{}:{body:JSON.stringify(payload)}),cache:'no-store'
      });
      if (response.status !== 401) break;
    }
    if (!response?.ok) {
      const details = await response?.json().catch(()=>null) as BrokerError | null;
      const code = details?.error?.code ?? 'service_unavailable';
      if (code === 'reconnect_required' || code === 'google_identity_mismatch') {
        this.reset();
        this.authorizationDeniedUid = user.uid;
        throw new DriveAuthorizationRequiredError();
      }
      const messages: Record<string,string> = {
        oauth_not_enabled:'O Google Drive ainda está sendo configurado.',
        user_not_authorized:'Esta conta não tem permissão para usar o Google Drive no Bem Feito.',
        google_identity_required:'Entre no Bem Feito com a conta Google autorizada.',
        user_identity_mismatch:'O e-mail do seu perfil não corresponde à sua conta Google.',
        refresh_busy:'O Drive está processando uma renovação. Tente novamente.',
        google_temporarily_unavailable:'O Google está temporariamente indisponível.',
        refresh_retry_later:'O acesso ao Google Drive está sendo restabelecido.',
        connection_changed:'A conexão do Drive foi atualizada. Tente novamente.'
      };
      throw new Error(messages[code] ?? 'Não foi possível comunicar com o serviço do Google Drive.');
    }
    return response.json() as Promise<T>;
  }

  private reset(): void {
    const had = this.tokenState() || this.linkedState() || this.accountState();
    this.tokenState.set(null);
    this.linkedState.set(false);
    this.accountState.set(null);
    this.authorizationDeniedUid = null;
    if (had) this.revisionState.update(value=>value+1);
  }

  private removeLegacyCredentials(): void {
    try { localStorage.removeItem(this.legacyTokenKey); } catch { /* ignore browser restrictions */ }
    try { sessionStorage.removeItem(this.legacyTokenKey); } catch { /* ignore browser restrictions */ }
    try { localStorage.removeItem(this.legacyGrantKey); } catch { /* ignore browser restrictions */ }
  }
}
