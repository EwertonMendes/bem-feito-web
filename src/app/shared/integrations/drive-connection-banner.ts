import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { DriveIntegrationService } from '../../core/google-drive/drive-integration.service';
import { ErrorService } from '../../core/services/error.service';
import { ToastService } from '../../core/services/toast.service';

@Component({
  selector: 'bf-drive-connection-banner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (integration.enabled && integration.config()?.enabled && !integration.connected()) {
      <div class="banner" role="status">
        <div><strong>Google Drive desconectado</strong><span>Conecte sua conta para carregar e alterar as imagens privadas.</span></div>
        <button class="bf-button secondary" type="button" (click)="connect()">Conectar Drive</button>
      </div>
    }
  `,
  styles: [`
    :host{display:block}.banner{display:flex;align-items:center;justify-content:space-between;gap:16px;margin:0 24px;padding:12px 14px;border:1px solid var(--line);border-radius:14px;background:var(--surface);box-shadow:var(--shadow)}.banner div{display:grid;gap:2px}.banner span{font-size:.8rem;color:var(--muted)}
    @media(max-width:700px){.banner{margin:0 14px;align-items:stretch;flex-direction:column}.banner .bf-button{width:100%}}
  `],
})
export class DriveConnectionBanner {
  readonly integration = inject(DriveIntegrationService);
  private readonly toast = inject(ToastService);
  private readonly errors = inject(ErrorService);

  constructor() {
    void this.integration.load();
  }

  async connect(): Promise<void> {
    try {
      await this.integration.connect();
      this.toast.success('Google Drive conectado.');
    } catch (error) {
      this.toast.error(this.errors.message(error));
    }
  }
}
