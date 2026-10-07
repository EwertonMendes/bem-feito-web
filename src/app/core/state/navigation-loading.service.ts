import { Injectable, inject, signal } from '@angular/core';
import { NavigationCancel, NavigationEnd, NavigationError, NavigationStart, Router } from '@angular/router';

@Injectable({ providedIn: 'root' })
export class NavigationLoadingService {
  private readonly router = inject(Router);
  private firstNavigationSettled = this.router.navigated;
  private routeTimer: ReturnType<typeof setTimeout> | null = null;
  private bootTimer: ReturnType<typeof setTimeout> | null = null;

  readonly bootVisible = signal(!this.router.navigated);
  readonly bootLeaving = signal(false);
  readonly routeLoading = signal(false);

  constructor() {
    this.router.events.subscribe((event) => {
      if (event instanceof NavigationStart) {
        this.beginNavigation();
        return;
      }

      if (event instanceof NavigationEnd) {
        if (!this.firstNavigationSettled) this.finishBoot();
        else this.finishRouteNavigation();
        return;
      }

      if (event instanceof NavigationError) {
        if (!this.firstNavigationSettled) this.finishBoot();
        else this.finishRouteNavigation();
        return;
      }

      if (event instanceof NavigationCancel && this.firstNavigationSettled) {
        this.finishRouteNavigation();
      }
    });
  }

  private beginNavigation(): void {
    if (!this.firstNavigationSettled) return;
    this.clearRouteTimer();
    this.routeTimer = setTimeout(() => {
      this.routeTimer = null;
      this.routeLoading.set(true);
    }, 180);
  }

  private finishBoot(): void {
    this.firstNavigationSettled = true;
    this.bootLeaving.set(true);
    if (this.bootTimer !== null) clearTimeout(this.bootTimer);
    this.bootTimer = setTimeout(() => {
      this.bootVisible.set(false);
      this.bootLeaving.set(false);
      this.bootTimer = null;
    }, 260);
  }

  private finishRouteNavigation(): void {
    this.clearRouteTimer();
    this.routeLoading.set(false);
  }

  private clearRouteTimer(): void {
    if (this.routeTimer === null) return;
    clearTimeout(this.routeTimer);
    this.routeTimer = null;
  }
}
