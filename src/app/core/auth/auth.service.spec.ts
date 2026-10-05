import '@angular/compiler';
import { Injector, runInInjectionContext } from '@angular/core';
import { Router } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FIREBASE_AUTH, FIRESTORE } from '../firebase/firebase.providers';
import { AuthService } from './auth.service';

const mocks = vi.hoisted(() => ({ getDoc: vi.fn(), popup: vi.fn(), redirectResult: vi.fn(), navigate: vi.fn() }));
vi.mock('firebase/auth', () => ({
  GoogleAuthProvider: class { setCustomParameters() {} },
  onAuthStateChanged: vi.fn(() => () => {}),
  getRedirectResult: mocks.redirectResult,
  signInWithPopup: mocks.popup,
  signInWithRedirect: vi.fn(), signOut: vi.fn(),
}));
vi.mock('firebase/firestore', () => ({ doc: vi.fn(), getDoc: mocks.getDoc }));

describe('Google login routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.redirectResult.mockResolvedValue(null);
    mocks.popup.mockResolvedValue({ user: { uid: 'test-user' } });
    mocks.navigate.mockResolvedValue(true);
  });
  for (const [profile, route] of [
    [{ active: true, role: 'owner' }, '/dashboard'],
    [{ active: false, role: 'viewer' }, '/acesso-negado'],
    [null, '/acesso-negado'],
  ] as const) {
    it(`routes ${JSON.stringify(profile)} to ${route}`, async () => {
      mocks.getDoc.mockResolvedValue({ exists: () => profile !== null, id: 'test-user', data: () => profile });
      const injector = Injector.create({ providers: [
        { provide: FIREBASE_AUTH, useValue: {} }, { provide: FIRESTORE, useValue: {} },
        { provide: Router, useValue: { navigateByUrl: mocks.navigate } },
      ] });
      const auth = runInInjectionContext(injector, () => new AuthService());
      await auth.loginWithGoogle();
      expect(mocks.navigate).toHaveBeenCalledWith(route);
      expect(auth.error()).toBeNull();
      expect(auth.busy()).toBe(false);
      injector.destroy();
    });
  }
});
