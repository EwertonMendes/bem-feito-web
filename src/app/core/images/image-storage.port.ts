import { Signal } from '@angular/core';
import { CatalogImageEntityKind, CatalogImageRef } from '../../domain/models/image.model';

export type ImageStorageAvailability = 'loading' | 'available' | 'unavailable';

export abstract class ImageStoragePort {
  abstract readonly enabled: boolean;
  abstract readonly revision: Signal<number>;
  abstract readonly availability: Signal<ImageStorageAvailability>;
  abstract resolve(image?: CatalogImageRef): Promise<string | null>;
  abstract save(kind: CatalogImageEntityKind, entityId: string, file: File, existing?: CatalogImageRef): Promise<CatalogImageRef>;
  abstract remove(kind: CatalogImageEntityKind, entityId: string, image?: CatalogImageRef): Promise<void>;
}
