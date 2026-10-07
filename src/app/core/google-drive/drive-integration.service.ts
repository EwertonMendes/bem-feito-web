import { Injectable, computed, inject, signal } from '@angular/core';
import { environment } from '../../../environments/environment';
import { CatalogImageEntityKind } from '../../domain/models/image.model';
import { GoogleDriveIntegration } from '../../domain/models/integration.model';
import { AuthService } from '../auth/auth.service';
import { DriveIntegrationRepository } from '../repositories/drive-integration.repository';
import { DriveApiError, DriveApiService } from './drive-api.service';
import { DriveAuthService } from './drive-auth.service';
import { DrivePickerService } from './drive-picker.service';

export type DriveIntegrationStatus =
  | 'disabled'
  | 'loading'
  | 'unconfigured'
  | 'disconnected'
  | 'ready'
  | 'connected'
  | 'error';

@Injectable({ providedIn: 'root' })
export class DriveIntegrationService {
  private readonly repository = inject(DriveIntegrationRepository);
  private readonly driveAuth = inject(DriveAuthService);
  private readonly driveApi = inject(DriveApiService);
  private readonly picker = inject(DrivePickerService);
  private readonly auth = inject(AuthService);
  private readonly configState = signal<GoogleDriveIntegration | null>(null);
  private readonly statusState = signal<DriveIntegrationStatus>(environment.googleDrive.enabled ? 'loading' : 'disabled');
  private readonly errorState = signal<string | null>(null);
  private readonly authorizationNeededState = signal(false);
  private readonly configRevision = signal(0);
  private loaded = false;

  readonly enabled = environment.googleDrive.enabled;
  readonly config = this.configState.asReadonly();
  readonly status = this.statusState.asReadonly();
  readonly error = this.errorState.asReadonly();
  readonly authorizationNeeded = this.authorizationNeededState.asReadonly();
  readonly driveEmail = this.driveAuth.accountEmail;
  readonly revision = computed(() => this.driveAuth.revision() + this.configRevision());
  readonly linked = computed(() => Boolean(this.configState()?.enabled && this.driveAuth.linked()));
  readonly connected = computed(() => this.statusState() === 'connected' && this.driveAuth.connected());

  async load(force = false): Promise<void> {
    if (!this.enabled || (this.loaded && !force)) return;

    this.statusState.set('loading');
    try {
      const config = await this.repository.getConfig();
      this.configState.set(config);
      this.loaded = true;
      this.errorState.set(null);
      this.authorizationNeededState.set(false);
      this.configRevision.update((value) => value + 1);

      if (!config?.enabled) {
        this.statusState.set('unconfigured');
        return;
      }

      await this.auth.waitForUser();
      if (!this.driveAuth.currentToken()) {
        this.statusState.set(this.driveAuth.linked() ? 'ready' : 'disconnected');
        return;
      }

      await this.verifyAccount();
      await this.verifyConfiguredFolder(config);
      this.statusState.set('connected');
    } catch (error) {
      if (error instanceof DriveApiError && error.status === 401) {
        this.markAccessExpired(false);
        return;
      }
      this.fail(error);
    }
  }

  async configure(): Promise<void> {
    if (!this.enabled) throw new Error('A integração com Google Drive ainda não foi configurada no ambiente.');
    if (!this.auth.canAdminister()) throw new Error('Somente um owner pode configurar a pasta de imagens.');

    try {
      await this.driveAuth.connect();
      await this.verifyAccount();
      const folder = await this.picker.selectFolder();
      const metadata = await this.driveApi.getFile(folder.id);
      if (metadata.mimeType !== 'application/vnd.google-apps.folder' || metadata.trashed) {
        throw new Error('Selecione uma pasta válida do Google Drive.');
      }

      const [products, inputs, kits, additions] = await Promise.all([
        this.driveApi.ensureFolder(folder.id, 'products', 'products'),
        this.driveApi.ensureFolder(folder.id, 'inputs', 'inputs'),
        this.driveApi.ensureFolder(folder.id, 'kits', 'kits'),
        this.driveApi.ensureFolder(folder.id, 'additions', 'additions'),
      ]);

      const config: GoogleDriveIntegration = {
        id: 'google-drive',
        enabled: true,
        rootFolderId: folder.id,
        rootFolderName: folder.name,
        folders: { products: products.id, inputs: inputs.id, kits: kits.id, additions: additions.id },
      };
      await this.repository.saveConfig(config);
      this.configState.set(config);
      this.loaded = true;
      this.statusState.set('connected');
      this.errorState.set(null);
      this.authorizationNeededState.set(false);
      this.configRevision.update((value) => value + 1);
    } catch (error) {
      this.fail(error);
      throw error;
    }
  }

  async connect(): Promise<void> {
    if (!this.enabled) throw new Error('A integração com Google Drive ainda não foi configurada no ambiente.');
    if (!this.loaded) await this.load();

    const config = this.configState();
    if (!config?.enabled) throw new Error('A pasta de imagens ainda não foi configurada por um owner.');

    try {
      await this.driveAuth.connect();
      await this.verifyAccount();

      try {
        await this.verifyConfiguredFolder(config);
      } catch (error) {
        if (!(error instanceof DriveApiError) || ![403, 404].includes(error.status)) throw error;
        const selected = await this.picker.selectFolder();
        if (selected.id !== config.rootFolderId) {
          throw new Error('Selecione exatamente a pasta de imagens configurada para este ambiente.');
        }
        await this.verifyConfiguredFolder(config);
      }

      this.statusState.set('connected');
      this.errorState.set(null);
      this.authorizationNeededState.set(false);
    } catch (error) {
      if (error instanceof DriveApiError && error.status === 401) {
        this.markAccessExpired(true);
      } else {
        this.fail(error);
      }
      throw error;
    }
  }

  async ensureConnected(): Promise<void> {
    if (this.connected() && this.driveAuth.currentToken()) return;
    await this.connect();
  }

  noteAuthorizationRequired(): void {
    if (!this.configState()?.enabled) return;
    this.markAccessExpired(true);
  }

  folderFor(kind: CatalogImageEntityKind): string {
    const config = this.configState();
    if (!config?.enabled) throw new Error('A pasta de imagens não está configurada.');
    return config.folders[kind];
  }

  private async verifyAccount(): Promise<void> {
    const firebaseUser = await this.auth.waitForUser();
    const driveUser = await this.driveApi.currentUser();
    const firebaseEmail = firebaseUser?.email?.trim().toLowerCase();
    const driveEmail = driveUser.emailAddress.trim().toLowerCase();

    if (!firebaseEmail || firebaseEmail !== driveEmail) {
      this.driveAuth.disconnect();
      throw new Error('Conecte ao Google Drive usando a mesma conta Google usada para entrar no Bem Feito.');
    }

    this.driveAuth.setAccountEmail(driveUser.emailAddress);
  }

  private async verifyConfiguredFolder(config: GoogleDriveIntegration): Promise<void> {
    const root = await this.driveApi.getFile(config.rootFolderId);
    if (root.mimeType !== 'application/vnd.google-apps.folder' || root.trashed) {
      throw new Error('A pasta configurada não está disponível.');
    }
    await Promise.all(Object.values(config.folders).map((folderId) => this.driveApi.getFile(folderId)));
  }

  private markAccessExpired(notify: boolean): void {
    this.driveAuth.expireAccessToken();
    const linked = this.driveAuth.linked();
    this.statusState.set(linked ? 'ready' : 'disconnected');
    this.errorState.set(null);
    this.authorizationNeededState.set(notify && linked);
  }

  private fail(error: unknown): void {
    this.statusState.set('error');
    this.authorizationNeededState.set(false);
    this.errorState.set(error instanceof Error ? error.message : 'Não foi possível acessar o Google Drive.');
  }
}
