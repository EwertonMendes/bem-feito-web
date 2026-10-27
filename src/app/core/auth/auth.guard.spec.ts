import '@angular/compiler';
import { Injector, runInInjectionContext } from '@angular/core';
import { Router } from '@angular/router';
import { describe, expect, it, vi } from 'vitest';
import { AuthService } from './auth.service';
import { accessDeniedGuard } from './auth.guard';

type Profile = { active: boolean; role: 'owner' | 'operator' | 'viewer' };
const makeGuard = (
  user: { uid: string } | null,
  profile: Profile | null,
  failure?: Error,
) => {
  const router = { parseUrl: vi.fn((url: string) => ({ destination: url })) };
  const auth = {
    waitForUser: vi.fn().mockResolvedValue(user),
    resolveProfile: vi.fn().mockImplementation(async () => {
      if (failure) throw failure;
      return profile;
    }),
  };
  const injector = Injector.create({
    providers: [
      { provide: Router, useValue: router },
      { provide: AuthService, useValue: auth },
    ],
  });
  const run = async () => runInInjectionContext(
    injector,
    () => accessDeniedGuard({} as never, {} as never),
  );
  return { run, router, auth, injector };
};

describe('access-denied route authorization', () => {
  it('redirects visitors without a Firebase session to login', async () => {
    const { run, router, auth, injector } = makeGuard(null, null);
    expect(await run()).toEqual({ destination: '/login' });
    expect(router.parseUrl).toHaveBeenCalledWith('/login');
    expect(auth.resolveProfile).not.toHaveBeenCalled();
    injector.destroy();
  });

  for (const role of ['owner', 'operator', 'viewer'] as const) {
    it(`redirects an authenticated active ${role} away from stale denial URL`, async () => {
      const { run, router, injector } = makeGuard({ uid: 'uid1' }, { active: true, role });
      expect(await run()).toEqual({ destination: '/dashboard' });
      expect(router.parseUrl).toHaveBeenCalledWith('/dashboard');
      injector.destroy();
    });
  }

  it('shows the denial page to authenticated but inactive users', async () => {
    const { run, router, injector } = makeGuard({ uid: 'uid1' }, { active: false, role: 'viewer' });
    expect(await run()).toBe(true);
    expect(router.parseUrl).not.toHaveBeenCalled();
    injector.destroy();
  });

  it('shows the denial page to authenticated users without a profile', async () => {
    const { run, injector } = makeGuard({ uid: 'uid1' }, null);
    expect(await run()).toBe(true);
    injector.destroy();
  });

  it('allows access to the diagnostic page on Firestore read failures', async () => {
    const { run, router, injector } = makeGuard({ uid: 'uid1' }, null, new Error('permission-denied'));
    expect(await run()).toBe(true);
    expect(router.parseUrl).not.toHaveBeenCalled();
    injector.destroy();
  });
});
