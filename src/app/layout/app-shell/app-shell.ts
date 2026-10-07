import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  HostListener,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AuthService } from '../../core/auth/auth.service';
import { ThemeService } from '../../core/services/theme.service';
import { NavigationLoadingService } from '../../core/state/navigation-loading.service';
import { DriveConnectionBanner } from '../../features/google-drive/components/drive-connection-banner';
import { BfConfirmDialog } from '../../shared/ui/confirm-dialog/confirm-dialog';
import { BfIcon } from '../../shared/ui/icon/icon';
import type { BfIconName } from '../../shared/ui/icon/icon';

type MobilePlacement = 'primary' | 'more';
type MobilePanel = 'quick' | 'more' | null;

interface NavItem {
  label: string;
  mobileLabel?: string;
  path: string;
  icon: BfIconName;
  mobilePlacement: MobilePlacement;
}

@Component({
  selector: 'bf-app-shell',
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    BfConfirmDialog,
    BfIcon,
    DriveConnectionBanner,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './app-shell.html',
  styleUrl: './app-shell.scss',
})
export class AppShell {
  readonly auth = inject(AuthService);
  readonly theme = inject(ThemeService);
  readonly navigation = inject(NavigationLoadingService);

  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private readonly logoutConfirm = viewChild.required<BfConfirmDialog>('logoutConfirm');

  readonly mobilePanel = signal<MobilePanel>(null);
  readonly currentUrl = signal(this.router.url);
  private readonly failedAvatarUrl = signal<string | null>(null);

  readonly avatarUrl = computed(() => {
    const photoUrl = this.auth.user()?.photoURL?.trim() ?? '';
    return photoUrl && this.failedAvatarUrl() !== photoUrl ? photoUrl : null;
  });

  readonly nav: NavItem[] = [
    { label: 'Dashboard', mobileLabel: 'Início', path: '/dashboard', icon: 'dashboard', mobilePlacement: 'primary' },
    { label: 'Vendas', path: '/vendas', icon: 'sales', mobilePlacement: 'primary' },
    { label: 'Produção', path: '/producao', icon: 'production', mobilePlacement: 'more' },
    { label: 'Estoque', path: '/estoque', icon: 'inventory', mobilePlacement: 'primary' },
    { label: 'Financeiro', path: '/financeiro', icon: 'finance', mobilePlacement: 'more' },
    { label: 'Catálogo', path: '/catalogo', icon: 'catalog', mobilePlacement: 'more' },
    { label: 'Configurações', path: '/configuracoes', icon: 'settings', mobilePlacement: 'more' },
  ];

  readonly mobilePrimaryNav = this.nav.filter((item) => item.mobilePlacement === 'primary');
  readonly mobilePrimaryStart = this.mobilePrimaryNav.slice(0, 2);
  readonly mobilePrimaryEnd = this.mobilePrimaryNav.slice(2);
  readonly mobileMoreNav = this.nav.filter((item) => item.mobilePlacement === 'more');

  readonly mobileMoreActive = computed(() => {
    const currentPath = this.currentUrl().split('?')[0] ?? '';
    return this.mobileMoreNav.some(
      (item) => currentPath === item.path || currentPath.startsWith(item.path + '/'),
    );
  });

  constructor() {
    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((event) => {
        this.currentUrl.set(event.urlAfterRedirects);
        this.closeMobilePanel();
      });

    effect(() => {
      this.document.documentElement.classList.toggle(
        'bf-mobile-sheet-open',
        this.mobilePanel() !== null,
      );
    });

    this.destroyRef.onDestroy(() => {
      this.document.documentElement.classList.remove('bf-mobile-sheet-open');
    });
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.closeMobilePanel();
  }

  onAvatarError(): void {
    const photoUrl = this.auth.user()?.photoURL?.trim();
    if (photoUrl) this.failedAvatarUrl.set(photoUrl);
  }

  toggleMobilePanel(panel: Exclude<MobilePanel, null>): void {
    this.mobilePanel.update((current) => current === panel ? null : panel);
  }

  closeMobilePanel(): void {
    this.mobilePanel.set(null);
  }

  async mobileNavigate(path: string): Promise<void> {
    this.closeMobilePanel();
    await this.router.navigateByUrl(path);
  }

  toggleTheme(): void {
    this.theme.toggle();
  }

  async requestLogout(): Promise<void> {
    const confirmed = await this.logoutConfirm().open({
      title: 'Deseja sair?',
      message: 'Você precisará entrar novamente para acessar o Bem Feito.',
      confirmLabel: 'Sair',
      cancelLabel: 'Continuar no app',
      tone: 'danger',
      icon: 'logout',
    });

    if (!confirmed) return;

    this.closeMobilePanel();
    await this.auth.logout();
  }
}
