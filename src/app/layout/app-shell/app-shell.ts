import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { DriveConnectionBanner } from '../../shared/integrations/drive-connection-banner';
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
  private readonly router = inject(Router);
  readonly mobileMenuOpen = signal(false);
  readonly darkMode = signal(localStorage.getItem('bf-theme') === 'dark');
  readonly nav: NavItem[] = [
    { label: 'Dashboard', path: '/dashboard', icon: 'dashboard' },
    { label: 'Vendas', path: '/vendas', icon: 'sales' },
    { label: 'Produção', path: '/producao', icon: 'production' },
    { label: 'Estoque', path: '/estoque', icon: 'inventory' },
    { label: 'Financeiro', path: '/financeiro', icon: 'finance' },
    { label: 'Catálogo', path: '/catalogo', icon: 'catalog' },
    { label: 'Configurações', path: '/configuracoes', icon: 'settings' },
  ];

  constructor() { this.applyTheme(); }

  toggleTheme(): void {
    this.darkMode.update((value) => !value);
    localStorage.setItem('bf-theme', this.darkMode() ? 'dark' : 'light');
    this.applyTheme();
  }

  async quickNavigate(path: string): Promise<void> {
    this.mobileMenuOpen.set(false);
    await this.router.navigateByUrl(path);
  }

  private applyTheme(): void {
    document.documentElement.dataset['theme'] = this.darkMode() ? 'dark' : 'light';
  }
}
