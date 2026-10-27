import { computed, inject, Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import {
  Auth,
  GoogleAuthProvider,
  User,
  getRedirectResult,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut,
} from 'firebase/auth';
import { doc, getDocFromServer } from 'firebase/firestore';
import { UserProfile } from '../../domain/models/common.model';
import { FIREBASE_AUTH, FIRESTORE } from '../firebase/firebase.providers';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly auth = inject<Auth>(FIREBASE_AUTH);
  private readonly firestore = inject(FIRESTORE);
  private readonly router = inject(Router);

  private readonly userState = signal<User | null | undefined>(undefined);
  private readonly profileState = signal<UserProfile | null>(null);
  private readonly busyState = signal(false);
  private readonly errorState = signal<string | null>(null);

  readonly user = computed(() => this.userState() ?? null);
  readonly profile = this.profileState.asReadonly();
  readonly busy = this.busyState.asReadonly();
  readonly error = this.errorState.asReadonly();
  readonly resolved = computed(() => this.userState() !== undefined);
  readonly role = computed(() => this.profileState()?.role ?? null);
  readonly canOperate = computed(() => this.role() === 'owner' || this.role() === 'operator');
  readonly canAdminister = computed(() => this.role() === 'owner');
  readonly profileErrorCode = signal<string | null>(null);

  constructor() {
    onAuthStateChanged(this.auth, (user) => {
      const oldUid = this.userState()?.uid;
      this.userState.set(user);
      if (!user || oldUid !== user.uid) {
        // The profile is tied to the exact Firebase Auth UID, not the email.
        this.profileState.set(null);
        this.profileErrorCode.set(null);
      }
    });
    void this.completeRedirect();
  }

  async loginWithGoogle(): Promise<void> {
    this.busyState.set(true);
    this.errorState.set(null);
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    try {
      const result = await signInWithPopup(this.auth, provider);
      await this.finishLogin(result.user);
    } catch (error) {
      if (this.firebaseCode(error) === 'auth/popup-blocked') {
        await signInWithRedirect(this.auth, provider);
        return;
      }
      this.errorState.set(this.authError(error));
    } finally {
      this.busyState.set(false);
    }
  }

  async logout(): Promise<void> {
    await signOut(this.auth);
    this.profileState.set(null);
    this.profileErrorCode.set(null);
    await this.router.navigateByUrl('/login');
  }

  async waitForUser(): Promise<User | null> {
    if (this.resolved()) return this.user();
    return new Promise<User | null>((resolve, reject) => {
      const unsubscribe = onAuthStateChanged(this.auth, (user) => {
        unsubscribe();
        this.userState.set(user);
        resolve(user);
      }, (error) => {
        unsubscribe();
        reject(error);
      });
    });
  }

  /**
   * Profile authorization is an explicit server read. Cached listeners previously
   * raced with popup, guards and retries, sometimes replacing a valid owner
   * profile with a stale negative result.
   */
  async resolveProfile(user: User | null): Promise<UserProfile | null> {
    if (!user) {
      this.profileState.set(null);
      this.profileErrorCode.set(null);
      return null;
    }
    try {
      const snapshot = await getDocFromServer(doc(this.firestore, 'users', user.uid));
      const profile = snapshot.exists()
        ? ({ id: snapshot.id, ...snapshot.data() } as UserProfile)
        : null;
      // A result from a previous login must never overwrite a newer session.
      const activeUid = this.userState()?.uid;
      if (activeUid === undefined || activeUid === user.uid) {
        this.profileState.set(profile);
        this.profileErrorCode.set(null);
      }
      return profile;
    } catch (error) {
      const code = this.firebaseCode(error) || 'firestore/unknown';
      this.profileErrorCode.set(code);
      this.errorState.set(this.profileReadError(code));
      // Never call a transient Firestore failure "account not authorized".
      throw error;
    }
  }

  async retryProfile(): Promise<UserProfile | null> {
    const user = await this.waitForUser();
    return this.resolveProfile(user);
  }

  private profileReadError(code: string): string {
    if (code === 'permission-denied') return 'Firestore negou a leitura do perfil (permission-denied).';
    if (code === 'unavailable') return 'Firestore indisponível. Verifique a conexão e tente novamente.';
    return 'Falha ao consultar o perfil no Firestore (' + code + ').';
  }

  private async completeRedirect(): Promise<void> {
    try {
      const result = await getRedirectResult(this.auth);
      if (result?.user) await this.finishLogin(result.user);
    } catch (error) {
      this.errorState.set(this.authError(error));
    }
  }

  private async finishLogin(user: User): Promise<void> {
    const profile = await this.resolveProfile(user);
    await this.router.navigateByUrl(profile?.active === true ? '/dashboard' : '/acesso-negado');
  }

  private firebaseCode(error: unknown): string {
    return typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
  }

  private authError(error: unknown): string {
    const code = this.firebaseCode(error);
    if (code === 'auth/popup-closed-by-user') return 'Login cancelado.';
    if (code === 'auth/network-request-failed') return 'Sem conexão com o Firebase.';
    if (code === 'auth/unauthorized-domain') return 'Este domínio ainda não foi autorizado no Firebase Authentication.';
    return 'Não foi possível entrar. Verifique a configuração do Firebase.';
  }
}
