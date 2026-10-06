import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { AuthService } from '../../../core/auth/auth.service';
import { DriveIntegrationService } from '../../../core/google-drive/drive-integration.service';
import { ErrorService } from '../../../core/services/error.service';
import { ToastService } from '../../../core/services/toast.service';

@Component({
  selector: 'bf-google-drive-settings-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="drive-card">
      <div class="drive-main">
        <img
          class="drive-logo"
          src="/assets/custom-icons/Google_Drive_icon.svg"
          width="44"
          height="40"
          alt=""
          aria-hidden="true"
        />

        <div class="drive-copy">
          <div class="title">
            <strong>Imagens no Google Drive</strong>
            <span>Arquivos privados, acessíveis somente pelas contas compartilhadas na pasta.</span>
          </div>

          @if (!integration.enabled) {
            <p class="muted">A integração está desativada neste ambiente.</p>
          } @else if (integration.config(); as config) {
            <div class="status">
              <span class="bf-badge" [class.warning]="!integration.connected()">{{ statusLabel() }}</span>
              <span>{{ config.rootFolderName }}</span>
              @if (integration.driveEmail()) { <small>{{ integration.driveEmail() }}</small> }
            </div>
            @if (integration.error()) { <p class="error">{{ integration.error() }}</p> }
          } @else {
            <p class="muted">Nenhuma pasta foi configurada ainda.</p>
          }
        </div>
      </div>

      @if (integration.enabled) {
        <div class="actions">
          @if (integration.config()) {
            <button
              class="bf-button secondary"
              type="button"
              [disabled]="busy()"
              (click)="connect()"
            >
              {{ busy() === 'connect' ? 'Conectando...' : 'Conectar Drive' }}
            </button>
          }
          @if (auth.canAdminister()) {
            <button
              class="bf-button"
              type="button"
              [disabled]="busy()"
              (click)="configure()"
            >
              {{ busy() === 'configure'
                ? 'Abrindo...'
                : integration.config() ? 'Alterar pasta' : 'Configurar pasta' }}
            </button>
          }
        </div>
      }
    </section>
  `,
  styles: [`
    .drive-card{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:18px 20px;margin-bottom:20px;border:1px solid var(--line);border-radius:16px;background:var(--surface);box-shadow:var(--shadow)}
    .drive-main{display:flex;align-items:center;gap:16px;min-width:0}.drive-logo{display:block;width:44px;height:40px;flex:0 0 44px;object-fit:contain}.drive-copy{display:grid;gap:10px;min-width:0}.title{display:grid;gap:3px}.title span,.muted,.status small{color:var(--muted);font-size:.82rem}.status{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.error{margin:0;color:var(--danger);font-size:.82rem}.actions{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}
    @media(max-width:700px){.drive-card{align-items:stretch;flex-direction:column}.drive-main{align-items:center}.actions{justify-content:stretch}.actions .bf-button{flex:1}}
  `],
})
export class GoogleDriveSettingsCard {
  readonly integration = inject(DriveIntegrationService);
  readonly auth = inject(AuthService);
  readonly busy = signal<'connect' | 'configure' | null>(null);

  private readonly toast = inject(ToastService);
  private readonly errors = inject(ErrorService);

  constructor() {
    void this.integration.load();
  }

  statusLabel(): string {
    const status = this.integration.status();
    if (this.integration.connected()) return 'Conectado';
    if (status === 'loading') return 'Carregando';
    if (status === 'error') return 'Atenção';
    return 'Desconectado';
  }

  async connect(): Promise<void> {
    if (this.busy()) return;
    this.busy.set('connect');
    try {
      await this.integration.connect();
      this.toast.success('Google Drive conectado.');
    } catch (error) {
      this.toast.error(this.errors.message(error));
    } finally {
      this.busy.set(null);
    }
  }

  async configure(): Promise<void> {
    if (this.busy()) return;
    this.busy.set('configure');
    try {
      await this.integration.configure();
      this.toast.success('Pasta de imagens configurada.');
    } catch (error) {
      this.toast.error(this.errors.message(error));
    } finally {
      this.busy.set(null);
    }
  }
}
