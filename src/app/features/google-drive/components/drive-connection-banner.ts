import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { DriveIntegrationService } from '../../../core/google-drive/drive-integration.service';
import { ErrorService } from '../../../core/services/error.service';
import { ToastService } from '../../../core/services/toast.service';

@Component({
  selector: 'bf-drive-connection-banner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (integration.enabled && integration.config()?.enabled && (integration.status() === 'disconnected' || integration.status() === 'error')) {
      <div class="banner" role="status">
        <div>
          <strong>{{ integration.status() === 'error' ? 'Google Drive indisponível' : 'Google Drive desconectado' }}</strong>
          <span>{{ integration.status() === 'error' ? 'Não foi possível validar o acesso às imagens privadas.' : 'Conecte sua conta para carregar e alterar as imagens privadas.' }}</span>
        </div>
        <button class="bf-button secondary" type="button" [disabled]="connecting()" (click)="connect()">{{ connecting() ? 'Conectando...' : 'Conectar Drive' }}</button>
      </div>
    }
  `,
  styles: [`
    :host{display:block}
    .banner{width:min(calc(100% - 68px),calc(var(--content-max) - 68px));display:flex;align-items:center;justify-content:space-between;gap:16px;margin:28px auto 0;padding:12px 14px;border:1px solid var(--line);border-radius:14px;background:var(--surface);box-shadow:var(--shadow)}
    .banner div{display:grid;gap:2px}.banner span{font-size:.8rem;color:var(--muted)}
    @media(max-width:980px){.banner{width:calc(100% - 40px);margin-top:24px}}
    @media(max-width:700px){.banner{align-items:stretch;flex-direction:column}.banner .bf-button{width:100%}}
    @media(max-width:640px){.banner{width:calc(100% - 32px);margin-top:20px}}
  `],
})
export class DriveConnectionBanner {
  readonly integration = inject(DriveIntegrationService);
  readonly connecting = signal(false);
  private readonly toast = inject(ToastService);
  private readonly errors = inject(ErrorService);

  constructor() {
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
}
