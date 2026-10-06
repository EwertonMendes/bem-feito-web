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
import { Unsubscribe, doc, onSnapshot } from 'firebase/firestore';
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
  private profileUid: string | null = null;
  private profileUnsubscribe: Unsubscribe | null = null;
  private profileReady: Promise<UserProfile | null> | null = null;

  readonly user = computed(() => this.userState() ?? null);
  readonly profile = this.profileState.asReadonly();
  readonly busy = this.busyState.asReadonly();
  readonly error = this.errorState.asReadonly();
  readonly resolved = computed(() => this.userState() !== undefined);
  readonly role = computed(() => this.profileState()?.role ?? null);
  readonly canOperate = computed(() => this.role() === 'owner' || this.role() === 'operator');
  readonly canAdminister = computed(() => this.role() === 'owner');

  constructor() {
    onAuthStateChanged(this.auth, (user) => {
      this.userState.set(user);
      if (user) {
        void this.ensureProfileListener(user).catch((error) => {
          this.errorState.set(this.authError(error));
        });
      } else {
        this.clearProfileListener();
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
    this.clearProfileListener();
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

  async resolveProfile(user: User | null): Promise<UserProfile | null> {
    if (!user) {
      this.clearProfileListener();
      return null;
    }
    return this.ensureProfileListener(user);
  }

  private ensureProfileListener(user: User): Promise<UserProfile | null> {
    if (this.profileUid === user.uid && this.profileReady) return this.profileReady;

    this.clearProfileListener();
    this.profileUid = user.uid;
    this.profileReady = new Promise<UserProfile | null>((resolve, reject) => {
      let initial = true;
      this.profileUnsubscribe = onSnapshot(
        doc(this.firestore, 'users', user.uid),
        (snapshot) => {
          const profile = snapshot.exists()
            ? ({ id: snapshot.id, ...snapshot.data() } as UserProfile)
            : null;
          this.profileState.set(profile);
          if (initial) {
            initial = false;
            resolve(profile);
          }
        },
        (error) => {
          this.profileState.set(null);
          if (initial) {
            initial = false;
            reject(error);
          }
        },
      );
    });

    return this.profileReady;
  }

  private clearProfileListener(): void {
    this.profileUnsubscribe?.();
    this.profileUnsubscribe = null;
    this.profileUid = null;
    this.profileReady = null;
    this.profileState.set(null);
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
