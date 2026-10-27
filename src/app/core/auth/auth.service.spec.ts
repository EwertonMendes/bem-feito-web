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
  doc: vi.fn((_db, col, id) => ({ col, id })),
  getDocFromServer: mocks.serverProfile,
}));

function setup(): { auth: AuthService; injector: Injector } {
  const injector = Injector.create({ providers: [
    { provide: FIREBASE_AUTH, useValue: {} },
    { provide: FIRESTORE, useValue: {} },
    { provide: Router, useValue: { navigateByUrl: mocks.navigate } },
  ] });
  const auth = runInInjectionContext(injector, () => new AuthService());
  return { auth, injector };
}

describe('Firebase server-authoritative profile access', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.profile = null;
    mocks.redirectResult.mockResolvedValue(null);
    mocks.popup.mockResolvedValue({ user: { uid: 'test-user' } });
    mocks.navigate.mockResolvedValue(true);
    mocks.serverProfile.mockImplementation(async () => ({
      id: 'test-user',
      exists: () => mocks.profile !== null,
      data: () => mocks.profile,
    }));
  });

  it('allows a previously authorized owner from the Firestore server', async () => {
    mocks.profile = { active: true, role: 'owner' };
    const { auth, injector } = setup();
    await auth.loginWithGoogle();
    expect(mocks.serverProfile).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).toHaveBeenCalledWith('/dashboard');
    expect(auth.profile()?.role).toBe('owner');
    injector.destroy();
  });

  it('denies a confirmed inactive server profile', async () => {
    mocks.profile = { active: false, role: 'viewer' };
    const { auth, injector } = setup();
    await auth.loginWithGoogle();
    expect(mocks.navigate).toHaveBeenCalledWith('/acesso-negado');
    expect(auth.profileErrorCode()).toBeNull();
    injector.destroy();
  });

  it('denies a confirmed missing server profile', async () => {
    const { auth, injector } = setup();
    await auth.loginWithGoogle();
    expect(mocks.navigate).toHaveBeenCalledWith('/acesso-negado');
    expect(auth.profile()).toBeNull();
    injector.destroy();
  });

  it('does not confuse a permission-denied error with a missing profile', async () => {
    mocks.serverProfile.mockRejectedValue({ code: 'permission-denied' });
    const { auth, injector } = setup();
    await auth.loginWithGoogle();
    expect(auth.profileErrorCode()).toBe('permission-denied');
    expect(auth.error()).toContain('permission-denied');
    expect(mocks.navigate).not.toHaveBeenCalledWith('/acesso-negado');
    injector.destroy();
  });

  it('can recheck the server without reopening the Google popup', async () => {
    const { auth, injector } = setup();
    await auth.loginWithGoogle();
    expect(mocks.navigate).toHaveBeenCalledWith('/acesso-negado');
    (auth as any).userState.set({ uid: 'test-user' });
    mocks.profile = { active: true, role: 'owner' };
    expect((await auth.retryProfile())?.active).toBe(true);
    expect(auth.profile()?.role).toBe('owner');
    expect(mocks.popup).toHaveBeenCalledTimes(1);
    injector.destroy();
  });
});
