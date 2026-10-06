import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import { DriveIntegrationService } from '../../../core/google-drive/drive-integration.service';
import { ErrorService } from '../../../core/services/error.service';
import { ToastService } from '../../../core/services/toast.service';
import { BfIcon } from '../../../shared/ui/icon/icon';

@Component({
  selector: 'bf-drive-connection-banner',
  imports: [BfIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (visible()) {
      <aside class="drive-notice" role="status" aria-live="polite">
        <button
          class="close"
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
          <strong>{{ integration.status() === 'error' ? 'Google Drive indisponível' : 'Google Drive desconectado' }}</strong>
          <span>
            {{ integration.status() === 'error'
              ? 'Não foi possível validar o acesso às imagens privadas.'
              : 'Conecte sua conta para carregar e alterar as imagens privadas.' }}
          </span>
        </div>

        <button
          class="bf-button secondary connect"
          type="button"
          [disabled]="connecting()"
          (click)="connect()"
        >
          {{ connecting() ? 'Conectando...' : 'Conectar Drive' }}
        </button>
      </aside>
    }
  `,
  styles: [`
    :host{display:contents}
    .drive-notice{position:fixed;left:50%;bottom:24px;z-index:55;width:min(560px,calc(100vw - 48px));transform:translateX(-50%);display:grid;grid-template-columns:44px minmax(0,1fr) auto;align-items:center;gap:14px;padding:16px 48px 16px 18px;border:1px solid var(--line);border-radius:18px;background:color-mix(in srgb,var(--surface) 96%,transparent);box-shadow:var(--shadow-dialog);backdrop-filter:blur(18px)}
    .drive-logo{display:block;width:42px;height:38px;object-fit:contain;align-self:center}
    .copy{display:grid;gap:3px;min-width:0;padding-right:2px}.copy strong{font-size:.9rem}.copy span{font-size:.78rem;line-height:1.4;color:var(--muted)}
    .connect{white-space:nowrap;align-self:center}
    .close{position:absolute;top:9px;right:9px;width:32px;height:32px;display:grid;place-items:center;border:1px solid var(--line);border-radius:50%;background:color-mix(in srgb,var(--surface-2) 92%,transparent);color:var(--muted-strong);cursor:pointer;transition:background 140ms ease,color 140ms ease,transform 140ms ease}
    .close:hover{background:var(--surface-3);color:var(--text);transform:scale(1.03)}
    .close bf-icon{width:17px;height:17px}
    @media(max-width:980px){.drive-notice{bottom:calc(94px + env(safe-area-inset-bottom));width:calc(100vw - 40px)}}
    @media(max-width:700px){.drive-notice{width:calc(100vw - 32px);grid-template-columns:40px minmax(0,1fr);gap:10px 12px;padding:15px 46px 15px 16px}.drive-logo{width:38px;height:34px}.connect{grid-column:2;justify-self:start}.copy{padding-right:0}}
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
    if (status === 'loading' || status === 'unconfigured' || status === 'disabled') return false;
    return status === 'error' || !this.integration.connected();
  });

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
      this.toast.success('Google Drive conectado.');
    } catch (error) {
      this.toast.error(this.errors.message(error));
    } finally {
      this.connecting.set(false);
    }
  }

  private isSettingsRoute(): boolean {
    const path = this.route().split(/[?#]/, 1)[0];
    return path === '/configuracoes';
  }
}
