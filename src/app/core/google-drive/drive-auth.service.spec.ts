import '@angular/compiler';
import { Injector, runInInjectionContext } from '@angular/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FIREBASE_AUTH } from '../firebase/firebase.providers';
import { DriveAuthService } from './drive-auth.service';
import { ExternalScriptLoaderService } from './external-script-loader.service';

const mocks = vi.hoisted(() => ({
  authCallbacks: [] as Array<(user: { uid: string; email?: string } | null) => void>,
}));

vi.mock('firebase/auth', () => ({
  onAuthStateChanged: vi.fn((_auth, callback) => {
    mocks.authCallbacks.push(callback);
    return () => {};
  }),
}));

class MemoryStorage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe('DriveAuthService', () => {
  let auth: { currentUser: { uid: string; email?: string } | null };
  let prompts: string[];
  let tokenSequence: number;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authCallbacks.length = 0;
    prompts = [];
    tokenSequence = 0;
    auth = { currentUser: null };

    vi.stubGlobal('sessionStorage', new MemoryStorage());
    vi.stubGlobal('localStorage', new MemoryStorage());
    vi.stubGlobal('window', {
      google: {
        accounts: {
          oauth2: {
            initTokenClient: vi.fn((config: { callback: (response: { access_token: string; expires_in: number }) => void }) => ({
              requestAccessToken: vi.fn(({ prompt }: { prompt?: string } = {}) => {
                prompts.push(prompt ?? '');
                tokenSequence += 1;
                config.callback({ access_token: `token-${tokenSequence}`, expires_in: 3600 });
              }),
            })),
          },
        },
      },
    });
  });

  function createService(): DriveAuthService {
    const scripts = { load: vi.fn().mockResolvedValue(undefined) };
    const injector = Injector.create({
      providers: [
        { provide: FIREBASE_AUTH, useValue: auth },
        { provide: ExternalScriptLoaderService, useValue: scripts },
      ],
    });
    const service = runInInjectionContext(injector, () => new DriveAuthService());
    return service;
  }

  function signIn(service: DriveAuthService): void {
    auth.currentUser = { uid: 'user-1', email: 'user@example.com' };
    expect(mocks.authCallbacks.length).toBeGreaterThan(0);
    mocks.authCallbacks.at(-1)?.(auth.currentUser);
    expect(service.linked()).toBe(false);
  }

  it('remembers the grant separately from the short-lived access token', async () => {
    const service = createService();
    signIn(service);

    expect(await service.connect()).toBe('token-1');
    service.setAccountEmail('user@example.com');

    expect(service.connected()).toBe(true);
    expect(service.linked()).toBe(true);
    expect(prompts).toEqual(['consent']);
    expect(localStorage.getItem('bem-feito:google-drive:development')).toContain('token-1');
    expect(localStorage.getItem('bem-feito:google-drive-grant:development')).toContain('user-1');

    service.expireAccessToken();

    expect(service.connected()).toBe(false);
    expect(service.linked()).toBe(true);
    expect(service.accountEmail()).toBe('user@example.com');
    expect(localStorage.getItem('bem-feito:google-drive:development')).toBeNull();
    expect(localStorage.getItem('bem-feito:google-drive-grant:development')).not.toBeNull();

    expect(await service.connect()).toBe('token-2');
    expect(prompts).toEqual(['consent', '']);
    expect(service.connected()).toBe(true);
  });

  it('restores a still-valid access token after closing and reopening the tab', async () => {
    const service = createService();
    signIn(service);
    await service.connect();
    service.setAccountEmail('user@example.com');

    const persistentStorage = localStorage;
    vi.stubGlobal('sessionStorage', new MemoryStorage());
    auth.currentUser = { uid: 'user-1', email: 'user@example.com' };

    const reopened = createService();

    expect(localStorage).toBe(persistentStorage);
    expect(reopened.currentToken()).toBe('token-1');
    expect(reopened.connected()).toBe(true);
    expect(reopened.linked()).toBe(true);
    expect(prompts).toEqual(['consent']);
  });

  it('resumes a remembered grant in a new tab even before the Drive auth listener fires', async () => {
    localStorage.setItem('bem-feito:google-drive-grant:development', JSON.stringify({
      firebaseUid: 'user-1',
      accountEmail: 'user@example.com',
      grantedAt: Date.now() - 60_000,
    }));
    auth.currentUser = { uid: 'user-1', email: 'user@example.com' };

    const service = createService();

    expect(service.linked()).toBe(false);
    expect(await service.connect()).toBe('token-1');

    expect(prompts).toEqual(['']);
    expect(service.linked()).toBe(true);
    expect(service.connected()).toBe(true);
    expect(service.currentToken()).toBe('token-1');
  });

  it('expires the access token on logout but can resume the remembered grant for the same Firebase user', async () => {
    const service = createService();
    signIn(service);
    await service.connect();
    service.setAccountEmail('user@example.com');

    auth.currentUser = null;
    mocks.authCallbacks.at(-1)?.(null);

    expect(service.connected()).toBe(false);
    expect(service.linked()).toBe(false);
    expect(localStorage.getItem('bem-feito:google-drive:development')).toBeNull();
    expect(localStorage.getItem('bem-feito:google-drive-grant:development')).toContain('user-1');

    auth.currentUser = { uid: 'user-1', email: 'user@example.com' };
    mocks.authCallbacks.at(-1)?.(auth.currentUser);

    expect(service.linked()).toBe(true);
    expect(await service.connect()).toBe('token-2');
    expect(prompts).toEqual(['consent', '']);
  });
});
