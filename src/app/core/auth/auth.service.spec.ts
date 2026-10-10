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
}));

describe('Google login routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.redirectResult.mockResolvedValue(null);
    mocks.popup.mockResolvedValue({ user: { uid: 'test-user' } });
    mocks.navigate.mockResolvedValue(true);
    mocks.profileListener.mockImplementation((_ref, next) => {
      next({
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
      .mockImplementationOnce((_ref, _next, error) => {
        error({ code: 'unavailable' });
        return () => {};
      })
      .mockImplementationOnce((_ref, next) => {
        next({
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
