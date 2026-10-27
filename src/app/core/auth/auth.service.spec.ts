import '@angular/compiler';
import { Injector, runInInjectionContext } from '@angular/core';
import { Router } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FIREBASE_AUTH, FIRESTORE } from '../firebase/firebase.providers';
import { AuthService } from './auth.service';

const mocks = vi.hoisted(() => ({
  profile: null as Record<string, unknown> | null,
  popup: vi.fn(),
  redirectResult: vi.fn(),
  navigate: vi.fn(),
  profileListener: vi.fn(),
  serverProfile: vi.fn(),
}));

vi.mock('firebase/auth', () => ({
  GoogleAuthProvider: class { setCustomParameters() {} },
  onAuthStateChanged: vi.fn(() => () => {}),
  getRedirectResult: mocks.redirectResult,
  signInWithPopup: mocks.popup,
  signInWithRedirect: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  onSnapshot: mocks.profileListener,
  getDocFromServer: mocks.serverProfile,
}));

describe('Google login routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.redirectResult.mockResolvedValue(null);
    mocks.popup.mockResolvedValue({ user: { uid: 'test-user' } });
    mocks.navigate.mockResolvedValue(true);
    mocks.serverProfile.mockImplementation(async () => ({ id: 'test-user', exists: () => mocks.profile !== null, data: () => mocks.profile }));
    mocks.profileListener.mockImplementation((_ref, _options, next) => {
      next({
        metadata: { fromCache: false },
        exists: () => mocks.profile !== null,
        id: 'test-user',
        data: () => mocks.profile,
      });
      return () => {};
    });
  });

  it('allows the profile listener to retry after a transient Firestore error', async () => {
    mocks.profile = { active: true, role: 'owner' };
    mocks.profileListener
      .mockImplementationOnce((_ref, _options, _next, error) => {
        error({ code: 'unavailable' });
        return () => {};
      })
      .mockImplementationOnce((_ref, _options, next) => {
        next({
          metadata: { fromCache: false },
          exists: () => true,
          id: 'test-user',
          data: () => mocks.profile,
        });
        return () => {};
      });

    const injector = Injector.create({ providers: [
      { provide: FIREBASE_AUTH, useValue: {} },
      { provide: FIRESTORE, useValue: {} },
      { provide: Router, useValue: { navigateByUrl: mocks.navigate } },
    ] });
    const auth = runInInjectionContext(injector, () => new AuthService());

    await auth.loginWithGoogle();
    expect(mocks.navigate).not.toHaveBeenCalled();

    await auth.loginWithGoogle();
    expect(mocks.profileListener).toHaveBeenCalledTimes(2);
    expect(mocks.navigate).toHaveBeenCalledWith('/dashboard');
    injector.destroy();
  });

  it('waits for server confirmation instead of denying a cached missing profile', async () => {
    mocks.profile = { active: true, role: 'owner' };
    mocks.profileListener.mockImplementation((_ref, options, next) => {
      expect(options).toEqual({ includeMetadataChanges: true });
      next({ id: 'test-user', exists: () => false, data: () => undefined,
        metadata: { fromCache: true } });
      queueMicrotask(() => next({ id: 'test-user', exists: () => true,
        data: () => mocks.profile, metadata: { fromCache: false } }));
      return () => {};
    });
    const injector = Injector.create({ providers: [
      { provide: FIREBASE_AUTH, useValue: {} },
      { provide: FIRESTORE, useValue: {} },
      { provide: Router, useValue: { navigateByUrl: mocks.navigate } },
    ] });
    const auth = runInInjectionContext(injector, () => new AuthService());

    await auth.loginWithGoogle();
    expect(mocks.navigate).toHaveBeenCalledWith('/dashboard');
    expect(mocks.navigate).not.toHaveBeenCalledWith('/acesso-negado');
    expect(auth.profile()?.active).toBe(true);
    injector.destroy();
  });

  it('checks the server when the listener reports a missing profile', async () => {
    mocks.profile = { active: true, role: 'owner' };
    mocks.profileListener.mockImplementation((_ref, _opts, next) => {
      next({ id: 'test-user', exists: () => false, data: () => null, metadata: { fromCache: false } });
      return () => {};
    });
    const injector = Injector.create({ providers: [
      { provide: FIREBASE_AUTH, useValue: {} },
      { provide: FIRESTORE, useValue: {} },
      { provide: Router, useValue: { navigateByUrl: mocks.navigate } },
    ] });
    const auth = runInInjectionContext(injector, () => new AuthService());
    await auth.loginWithGoogle();
    expect(mocks.serverProfile).toHaveBeenCalledOnce();
    expect(mocks.navigate).toHaveBeenCalledWith('/dashboard');
    injector.destroy();
  });

  it('rechecks the server directly after the profile is reactivated', async () => {
    mocks.profile = null;
    const injector = Injector.create({ providers: [
      { provide: FIREBASE_AUTH, useValue: {} },
      { provide: FIRESTORE, useValue: {} },
      { provide: Router, useValue: { navigateByUrl: mocks.navigate } },
    ] });
    const auth = runInInjectionContext(injector, () => new AuthService());
    await auth.loginWithGoogle();
    // The mocked Auth SDK does not emit onAuthStateChanged automatically.
    (auth as any).userState.set({ uid: 'test-user' });
    mocks.profile = { active: true, role: 'owner' };
    expect((await auth.retryProfile())?.role).toBe('owner');
    injector.destroy();
  });

  it('uses a newly authorized live profile instead of a stale missing result', async () => {
    let notify: (snapshot: any) => void = () => {};
    mocks.profileListener.mockImplementation((_ref, _opts, next) => {
      notify = next;
      next({ id: 'test-user', exists: () => false, data: () => undefined,
        metadata: { fromCache: false } });
      return () => {};
    });
    const injector = Injector.create({ providers: [
      { provide: FIREBASE_AUTH, useValue: {} },
      { provide: FIRESTORE, useValue: {} },
      { provide: Router, useValue: { navigateByUrl: mocks.navigate } },
    ] });
    const auth = runInInjectionContext(injector, () => new AuthService());

    await auth.loginWithGoogle();
    expect(mocks.navigate).toHaveBeenCalledWith('/acesso-negado');
    notify({ id: 'test-user', exists: () => true,
      data: () => ({ active: true, role: 'owner' }), metadata: { fromCache: false } });
    expect((await auth.resolveProfile({ uid: 'test-user' } as any))?.active).toBe(true);
    injector.destroy();
  });

  for (const [profile, route] of [
    [{ active: true, role: 'owner' }, '/dashboard'],
    [{ active: false, role: 'viewer' }, '/acesso-negado'],
    [null, '/acesso-negado'],
  ] as const) {
    it(`routes ${JSON.stringify(profile)} to ${route}`, async () => {
      mocks.profile = profile;
      const injector = Injector.create({ providers: [
        { provide: FIREBASE_AUTH, useValue: {} },
        { provide: FIRESTORE, useValue: {} },
        { provide: Router, useValue: { navigateByUrl: mocks.navigate } },
      ] });

      const auth = runInInjectionContext(injector, () => new AuthService());
      await auth.loginWithGoogle();

      expect(mocks.profileListener).toHaveBeenCalledTimes(1);
      expect(mocks.navigate).toHaveBeenCalledWith(route);
      expect(auth.error()).toBeNull();
      expect(auth.busy()).toBe(false);
      injector.destroy();
    });
  }
});
