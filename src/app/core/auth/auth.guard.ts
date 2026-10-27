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
