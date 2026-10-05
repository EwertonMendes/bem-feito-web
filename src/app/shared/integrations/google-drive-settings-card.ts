import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { AuthService } from '../../core/auth/auth.service';
import { DriveIntegrationService } from '../../core/google-drive/drive-integration.service';
import { ErrorService } from '../../core/services/error.service';
import { ToastService } from '../../core/services/toast.service';
import { BfIcon } from '../ui/icon/icon';

@Component({
  selector: 'bf-google-drive-settings-card',
  imports: [BfIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="drive-card">
      <div class="drive-copy">
        <div class="title"><bf-icon name="image" /><div><strong>Imagens no Google Drive</strong><span>Arquivos privados, acessíveis somente pelas contas compartilhadas na pasta.</span></div></div>
        @if (!integration.enabled) {
          <p class="muted">A integração está desativada neste ambiente.</p>
        } @else if (integration.config(); as config) {
          <div class="status">
            <span class="bf-badge" [class.warning]="integration.status() !== 'connected'">{{ statusLabel() }}</span>
            <span>{{ config.rootFolderName }}</span>
            @if (integration.driveEmail()) { <small>{{ integration.driveEmail() }}</small> }
          </div>
          @if (integration.error()) { <p class="error">{{ integration.error() }}</p> }
        } @else {
          <p class="muted">Nenhuma pasta foi configurada ainda.</p>
        }
      </div>

      @if (integration.enabled) {
        <div class="actions">
          @if (integration.config()) {
            <button class="bf-button secondary" type="button" (click)="connect()">Conectar Drive</button>
          }
          @if (auth.canAdminister()) {
            <button class="bf-button" type="button" (click)="configure()">{{ integration.config() ? 'Alterar pasta' : 'Configurar pasta' }}</button>
          }
        </div>
      }
    </section>
  `,
  styles: [`
    .drive-card{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:18px 20px;margin-bottom:20px;border:1px solid var(--line);border-radius:16px;background:var(--surface);box-shadow:var(--shadow)}
    .drive-copy{display:grid;gap:10px}.title{display:flex;align-items:flex-start;gap:12px}.title bf-icon{width:24px;height:24px;margin-top:2px}.title div{display:grid;gap:3px}.title span,.muted,.status small{color:var(--muted);font-size:.82rem}.status{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.error{margin:0;color:var(--danger);font-size:.82rem}.actions{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}
    @media(max-width:700px){.drive-card{align-items:stretch;flex-direction:column}.actions{justify-content:stretch}.actions .bf-button{flex:1}}
  `],
})
export class GoogleDriveSettingsCard {
  readonly integration = inject(DriveIntegrationService);
  readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly errors = inject(ErrorService);

  constructor() {
    void this.integration.load();
  }

  statusLabel(): string {
    const status = this.integration.status();
    if (status === 'connected') return 'Conectado';
    if (status === 'loading') return 'Carregando';
    if (status === 'error') return 'Atenção';
    return 'Desconectado';
  }

  async connect(): Promise<void> {
    try {
      await this.integration.connect();
      this.toast.success('Google Drive conectado.');
    } catch (error) {
      this.toast.error(this.errors.message(error));
    }
  }

  async configure(): Promise<void> {
    try {
      await this.integration.configure();
      this.toast.success('Pasta de imagens configurada.');
    } catch (error) {
      this.toast.error(this.errors.message(error));
    }
  }
}
