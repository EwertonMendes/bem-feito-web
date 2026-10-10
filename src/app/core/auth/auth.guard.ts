import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

export const authGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const user = await auth.waitForUser();
  if (!user) return router.parseUrl('/login');
  const profile = await auth.resolveProfile(user);
  return profile?.active === true ? true : router.parseUrl('/acesso-negado');
};
