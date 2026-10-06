import { Injectable, computed, effect, inject } from '@angular/core';
import { environment } from '../../../environments/environment';
import { CatalogImageEntityKind, CatalogImageRef } from '../../domain/models/image.model';
import { ImageStorageAvailability, ImageStoragePort } from '../images/image-storage.port';
import { ImageProcessorService } from '../images/image-processor.service';
import { DriveApiService, DriveFileMetadata } from './drive-api.service';
import { DriveAuthService, DriveAuthorizationRequiredError } from './drive-auth.service';
import { DriveIntegrationService } from './drive-integration.service';

const MAX_CACHED_IMAGE_URLS = 128;

@Injectable({ providedIn: 'root' })
export class GoogleDriveImageStorageService extends ImageStoragePort {
  private readonly processor = inject(ImageProcessorService);
  private readonly api = inject(DriveApiService);
  private readonly auth = inject(DriveAuthService);
  private readonly integration = inject(DriveIntegrationService);
  private readonly urlCache = new Map<string, string>();
  private readonly pendingDownloads = new Map<string, Promise<string | null>>();
  private cacheGeneration = 0;

  readonly enabled = environment.googleDrive.enabled;
  readonly revision = this.integration.revision;
  readonly availability = computed<ImageStorageAvailability>(() => {
    if (!this.enabled) return 'unavailable';
    const status = this.integration.status();
    if (status === 'loading') return 'loading';
    return status === 'connected' ? 'available' : 'unavailable';
  });

  constructor() {
    super();
    effect(() => {
      this.integration.revision();
      this.clearCache();
    });
  }

  async resolve(image?: CatalogImageRef): Promise<string | null> {
    if (!this.enabled || !image || image.provider !== 'google-drive' || !this.integration.connected() || !this.auth.currentToken()) return null;

    const key = this.cacheKey(image);
    const cached = this.urlCache.get(key);
    if (cached) {
      this.urlCache.delete(key);
      this.urlCache.set(key, cached);
      return cached;
    }
    const pending = this.pendingDownloads.get(key);
    if (pending) return pending;

    const generation = this.cacheGeneration;
    const request = this.api.download(image.fileId).then((blob) => {
      const url = URL.createObjectURL(blob);
      if (generation !== this.cacheGeneration) {
        URL.revokeObjectURL(url);
        return null;
      }
      this.cacheUrl(key, url);
      return url;
    }).catch((error) => {
      if (error instanceof DriveAuthorizationRequiredError) return null;
      throw error;
    }).finally(() => this.pendingDownloads.delete(key));

    this.pendingDownloads.set(key, request);
    return request;
  }

  async save(kind: CatalogImageEntityKind, entityId: string, file: File, existing?: CatalogImageRef): Promise<CatalogImageRef> {
    if (!this.enabled) throw new Error('O envio de imagens está indisponível neste ambiente.');
    await this.integration.ensureConnected();
    const processed = await this.processor.process(file);
    let metadata: DriveFileMetadata;

    if (existing) {
      await this.assertManagedFile(kind, entityId, existing);
      metadata = await this.api.updateImage(existing.fileId, processed.blob);
      this.invalidate(existing.fileId);
    } else {
      metadata = await this.api.createImage(
        this.integration.folderFor(kind),
        `${kind}_${entityId}.webp`,
        processed.blob,
        { app: 'bem-feito', entityType: kind, entityId },
      );
    }

    return {
      provider: 'google-drive',
      fileId: metadata.id,
      mimeType: 'image/webp',
      sizeBytes: Number(metadata.size ?? processed.blob.size),
      width: processed.width,
      height: processed.height,
      modifiedTime: metadata.modifiedTime ?? new Date().toISOString(),
    };
  }

  async remove(kind: CatalogImageEntityKind, entityId: string, image?: CatalogImageRef): Promise<void> {
    if (!this.enabled || !image) return;
    await this.integration.ensureConnected();
    await this.assertManagedFile(kind, entityId, image);
    await this.api.trash(image.fileId);
    this.invalidate(image.fileId);
  }

  private async assertManagedFile(kind: CatalogImageEntityKind, entityId: string, image: CatalogImageRef): Promise<void> {
    const metadata = await this.api.getFile(image.fileId);
    if (
      metadata.trashed ||
      metadata.mimeType !== 'image/webp' ||
      metadata.appProperties?.['app'] !== 'bem-feito' ||
      metadata.appProperties?.['entityType'] !== kind ||
      metadata.appProperties?.['entityId'] !== entityId
    ) {
      throw new Error('A imagem não pertence a este cadastro e não pode ser alterada.');
    }
  }

  private cacheKey(image: CatalogImageRef): string {
    return `${image.fileId}:${image.modifiedTime}`;
  }

  private invalidate(fileId: string): void {
    for (const [key, url] of this.urlCache) {
      if (!key.startsWith(`${fileId}:`)) continue;
      URL.revokeObjectURL(url);
      this.urlCache.delete(key);
    }
  }

  private cacheUrl(key: string, url: string): void {
    const existing = this.urlCache.get(key);
    if (existing && existing !== url) URL.revokeObjectURL(existing);
    this.urlCache.delete(key);
    this.urlCache.set(key, url);

    while (this.urlCache.size > MAX_CACHED_IMAGE_URLS) {
      const oldest = this.urlCache.entries().next().value as [string, string] | undefined;
      if (!oldest) break;
      URL.revokeObjectURL(oldest[1]);
      this.urlCache.delete(oldest[0]);
    }
  }

  private clearCache(): void {
    this.cacheGeneration += 1;
    for (const url of this.urlCache.values()) URL.revokeObjectURL(url);
    this.urlCache.clear();
    this.pendingDownloads.clear();
  }
}
