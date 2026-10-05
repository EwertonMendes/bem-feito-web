import { inject, Injectable } from '@angular/core';
import { CatalogImageEntityKind, CatalogImageRef } from '../../domain/models/image.model';
import { ImageStoragePort } from '../images/image-storage.port';

@Injectable({ providedIn: 'root' })
export class ImageService {
  private readonly storage = inject(ImageStoragePort);

  readonly enabled = this.storage.enabled;
  readonly revision = this.storage.revision;

  resolve(image?: CatalogImageRef): Promise<string | null> {
    return this.storage.resolve(image);
  }

  saveCatalogImage(kind: CatalogImageEntityKind, entityId: string, file: File, existing?: CatalogImageRef): Promise<CatalogImageRef> {
    return this.storage.save(kind, entityId, file, existing);
  }

  removeCatalogImage(kind: CatalogImageEntityKind, entityId: string, image?: CatalogImageRef): Promise<void> {
    return this.storage.remove(kind, entityId, image);
  }
}
