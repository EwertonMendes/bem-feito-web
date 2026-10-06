import { DOCUMENT } from '@angular/common';
import { computed, effect, inject, Injectable, signal } from '@angular/core';

export type BfTheme = 'light' | 'dark';
export type BfDarkPalette = 'espresso' | 'chocolate' | 'graphite' | 'wood' | 'walnut' | 'taupe';

const DARK_PALETTES: readonly BfDarkPalette[] = ['espresso', 'chocolate', 'graphite', 'wood', 'walnut', 'taupe'];

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly document = inject(DOCUMENT);

  readonly theme = signal<BfTheme>(this.readInitialTheme());
  readonly darkPalette = signal<BfDarkPalette>(this.readInitialDarkPalette());
  readonly darkMode = computed(() => this.theme() === 'dark');

  constructor() {
    effect(() => this.apply(this.theme(), this.darkPalette()));
  }

  toggle(): void {
    this.set(this.darkMode() ? 'light' : 'dark');
  }

  set(theme: BfTheme): void {
    this.theme.set(theme);
    this.persist('bf-theme', theme);
  }

  setDarkPalette(palette: BfDarkPalette): void {
    this.darkPalette.set(palette);
    this.persist('bf-dark-palette', palette);
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

  private readInitialDarkPalette(): BfDarkPalette {
    const initial = this.document.documentElement.dataset['darkPalette'];
    if (this.isDarkPalette(initial)) return initial;
    try {
      const stored = localStorage.getItem('bf-dark-palette');
      return this.isDarkPalette(stored) ? stored : 'espresso';
    } catch {
      return 'espresso';
    }
  }

  private isDarkPalette(value: string | null | undefined): value is BfDarkPalette {
    return DARK_PALETTES.includes(value as BfDarkPalette);
  }

  private persist(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Storage can be unavailable in hardened/private browser contexts.
    }
  }

  private apply(theme: BfTheme, palette: BfDarkPalette): void {
    const root = this.document.documentElement;
    root.dataset['theme'] = theme;
    root.dataset['darkPalette'] = palette;
    root.style.colorScheme = theme;

    const darkBackground: Record<BfDarkPalette, string> = {
      espresso: '#14110f',
      chocolate: '#16110d',
      graphite: '#151312',
      wood: '#241a15',
      walnut: '#2a1e19',
      taupe: '#29231f',
    };

    const meta = this.document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (meta) meta.content = theme === 'dark' ? darkBackground[palette] : '#f8f5ef';
  }
}
