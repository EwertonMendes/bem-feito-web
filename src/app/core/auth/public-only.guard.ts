import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

export const publicOnlyGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const user = await auth.waitForUser();
  if (!user) return true;
  const profile = await auth.resolveProfile(user);
  return profile?.active ? router.parseUrl('/dashboard') : true;
};
