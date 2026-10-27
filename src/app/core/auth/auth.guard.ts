import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

export const authGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const user = await auth.waitForUser();
  if (!user) return router.parseUrl('/login');
  try {
    const profile = await auth.resolveProfile(user);
    return profile?.active === true && ['owner', 'operator', 'viewer'].includes(profile.role)
      ? true : router.parseUrl('/acesso-negado');
  } catch {
    // Network / rules failures must not masquerade as revoked authorization.
    // The denied page surfaces the exact Firestore error code and allows retry.
    return router.parseUrl('/acesso-negado');
  }
};

/**
 * The denial page is only for authenticated users whose Firestore profile is
 * inactive or missing. It must never be a public landing page; authorized
 * users should also not remain stuck on a stale denial URL.
 */
export const accessDeniedGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const user = await auth.waitForUser();
  if (!user) return router.parseUrl('/login');

  try {
    const profile = await auth.resolveProfile(user);
    if (profile?.active === true && ['owner', 'operator', 'viewer'].includes(profile.role)) {
      return router.parseUrl('/dashboard');
    }
  } catch {
    // Authentication succeeded but profile reading failed. Let this page show
    // the specific Firestore error and offer a server-backed retry.
  }
  return true;
};
