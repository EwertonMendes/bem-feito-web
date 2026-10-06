import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { BfDarkPalette, ThemeService } from '../../core/services/theme.service';
import { DriveConnectionBanner } from '../../features/google-drive/components/drive-connection-banner';
import { BfIcon, BfIconName } from '../../shared/ui/icon/icon';

interface NavItem { label: string; path: string; icon: BfIconName; }

@Component({
  selector: 'bf-app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, BfIcon, DriveConnectionBanner],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './app-shell.html',
  styleUrl: './app-shell.scss',
})
export class AppShell {
  readonly auth = inject(AuthService);
  readonly theme = inject(ThemeService);
  private readonly router = inject(Router);

  readonly mobileMenuOpen = signal(false);
  readonly darkPalettes: ReadonlyArray<{ id: BfDarkPalette; label: string; shortLabel: string }> = [
    { id: 'espresso', label: 'Espresso & Sálvia', shortLabel: 'Espresso' },
    { id: 'chocolate', label: 'Chocolate & Marfim', shortLabel: 'Chocolate' },
    { id: 'graphite', label: 'Grafite quente & Verde botânico', shortLabel: 'Grafite' },
    { id: 'wood', label: 'Madeira & Musgo', shortLabel: 'Madeira' },
    { id: 'walnut', label: 'Nogueira & Sálvia', shortLabel: 'Nogueira' },
    { id: 'taupe', label: 'Taupe & Oliva', shortLabel: 'Taupe' },
  ];
  private readonly failedAvatarUrl = signal<string | null>(null);
  readonly avatarUrl = computed(() => {
    const photoUrl = this.auth.user()?.photoURL?.trim() ?? '';
    return photoUrl && this.failedAvatarUrl() !== photoUrl ? photoUrl : null;
  });

  readonly nav: NavItem[] = [
    { label: 'Dashboard', path: '/dashboard', icon: 'dashboard' },
    { label: 'Vendas', path: '/vendas', icon: 'sales' },
    { label: 'Produção', path: '/producao', icon: 'production' },
    { label: 'Estoque', path: '/estoque', icon: 'inventory' },
    { label: 'Financeiro', path: '/financeiro', icon: 'finance' },
    { label: 'Catálogo', path: '/catalogo', icon: 'catalog' },
    { label: 'Configurações', path: '/configuracoes', icon: 'settings' },
  ];

  onAvatarError(): void {
    const photoUrl = this.auth.user()?.photoURL?.trim();
    if (photoUrl) this.failedAvatarUrl.set(photoUrl);
  }

  async quickNavigate(path: string): Promise<void> {
    this.mobileMenuOpen.set(false);
    await this.router.navigateByUrl(path);
  }
}
