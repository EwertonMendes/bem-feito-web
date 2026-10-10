import { DOCUMENT } from '@angular/common';
import { computed, effect, inject, Injectable, signal } from '@angular/core';

export type BfTheme = 'light' | 'dark';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly document = inject(DOCUMENT);

  readonly theme = signal<BfTheme>(this.readInitialTheme());
  readonly darkMode = computed(() => this.theme() === 'dark');

  constructor() {
    effect(() => this.apply(this.theme()));
  }

  toggle(): void {
    this.set(this.darkMode() ? 'light' : 'dark');
  }

  set(theme: BfTheme): void {
    this.theme.set(theme);
    try {
      localStorage.setItem('bf-theme', theme);
    } catch {
      // Storage can be unavailable in hardened/private browser contexts.
    }
  }

  private readInitialTheme(): BfTheme {
    const initial = this.document.documentElement.dataset['theme'];
    if (initial === 'dark' || initial === 'light') return initial;
    try {
      return localStorage.getItem('bf-theme') === 'dark' ? 'dark' : 'light';
    } catch {
      return 'light';
    }
  }

  private apply(theme: BfTheme): void {
    const root = this.document.documentElement;
    root.dataset['theme'] = theme;
    root.style.colorScheme = theme;

    const meta = this.document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (meta) meta.content = theme === 'dark' ? '#29231f' : '#f8f5ef';
  }
}
