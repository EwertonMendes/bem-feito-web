import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import { DriveIntegrationService } from '../../../core/google-drive/drive-integration.service';
import { ErrorService } from '../../../core/services/error.service';
import { ToastService } from '../../../core/services/toast.service';
import { DriveRedirectStartedError } from '../../../core/google-drive/drive-auth.service';
import { BfLoadingButton } from '../../../shared/ui/button/loading-button';
import { BfIcon } from '../../../shared/ui/icon/icon';

@Component({
  selector: 'bf-drive-connection-banner',
  imports: [BfIcon, BfLoadingButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (visible()) {
      <aside class="drive-notice" role="status" aria-live="polite">
        <button
          class="bf-floating-close"
          type="button"
          aria-label="Fechar aviso do Google Drive"
          (click)="dismissed.set(true)"
        >
          <bf-icon name="close" />
        </button>

        <img
          class="drive-logo"
          src="/assets/custom-icons/Google_Drive_icon.svg"
          width="42"
          height="38"
          alt=""
          aria-hidden="true"
        />

        <div class="copy">
          <strong>{{ title() }}</strong>
          <span>{{ message() }}</span>
        </div>

        <button
          class="bf-button secondary connect"
          type="button"
          [disabled]="connecting()"
          [bfLoadingButton]="connecting()"
          (click)="connect()"
        >
          {{ connecting() ? 'Conectando...' : actionLabel() }}
        </button>
      </aside>
    }
  `,
  styles: [`
    :host{display:contents}
    .drive-notice{position:fixed;left:50%;bottom:24px;z-index:55;width:min(560px,calc(100vw - 48px));transform:translateX(-50%);display:grid;grid-template-columns:44px minmax(0,1fr) auto;align-items:center;gap:14px;padding:16px 18px;border:1px solid var(--line);border-radius:18px;background:color-mix(in srgb,var(--surface) 96%,transparent);box-shadow:var(--shadow-dialog);backdrop-filter:blur(18px)}
    .drive-logo{display:block;width:42px;height:38px;object-fit:contain;align-self:center}
    .copy{display:grid;gap:3px;min-width:0;padding-right:2px}.copy strong{font-size:.9rem}.copy span{font-size:.78rem;line-height:1.4;color:var(--muted)}
    .connect{white-space:nowrap;align-self:center}
    /* A compact 32px face anchored to the rounded top-right corner, not the interior. */
    .drive-notice .bf-floating-close{--bf-close-inset:6px;--bf-close-icon-size:14px;top:-19px;right:-20px}
    /* Inside the notice on tablets/phones: neither the button nor its shadow
       reaches the screen edge, and text/actions keep a reserved right gutter. */
    @media(max-width:980px){.drive-notice{bottom:calc(94px + env(safe-area-inset-bottom));width:calc(100vw - 40px);padding-right:58px}.drive-notice .bf-floating-close{top:6px;right:6px}}
    @media(max-width:700px){.drive-notice{width:calc(100vw - 32px);grid-template-columns:40px minmax(0,1fr);gap:10px 12px;padding:15px 54px 15px 16px}.drive-notice .bf-floating-close{top:5px;right:5px}.drive-logo{width:38px;height:34px}.connect{grid-column:2;justify-self:start}.copy{padding-right:0}}
  `],
})
export class DriveConnectionBanner {
  readonly integration = inject(DriveIntegrationService);
  readonly connecting = signal(false);
  readonly dismissed = signal(false);

  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly errors = inject(ErrorService);
  private readonly route = signal(this.router.url);

  readonly visible = computed(() => {
    if (this.dismissed() || this.isSettingsRoute()) return false;
    if (!this.integration.enabled || !this.integration.config()?.enabled) return false;

    const status = this.integration.status();
    if (status === 'loading' || status === 'unconfigured' || status === 'disabled' || status === 'connected') {
      return false;
    }
    if (status === 'ready') return this.integration.authorizationNeeded();
    return status === 'error' || status === 'disconnected';
  });

  readonly title = computed(() => {
    const status = this.integration.status();
    if (status === 'ready') return 'Continuar com Google Drive';
    if (status === 'error') return 'Google Drive indisponível';
    return 'Google Drive desconectado';
  });

  readonly message = computed(() => {
    const status = this.integration.status();
    if (status === 'ready') {
      return 'A autorização do Google Drive precisa ser renovada.';
    }
    if (status === 'error') return 'Não foi possível validar o acesso às imagens privadas.';
    return 'Conecte sua conta para carregar e alterar as imagens privadas.';
  });

  readonly actionLabel = computed(() => this.integration.status() === 'ready' ? 'Continuar' : 'Conectar Drive');

  constructor() {
    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe((event) => this.route.set(event.urlAfterRedirects));

    void this.integration.load();
  }

  async connect(): Promise<void> {
    if (this.connecting()) return;
    this.connecting.set(true);

    try {
      await this.integration.connect();
      this.dismissed.set(false);
      this.toast.success('Google Drive conectado.');
    } catch (error) {
      if (!(error instanceof DriveRedirectStartedError)) this.toast.error(this.errors.message(error));
    } finally {
      this.connecting.set(false);
    }
  }

  private isSettingsRoute(): boolean {
    const path = this.route().split(/[?#]/, 1)[0];
    return path === '/configuracoes';
  }
}
