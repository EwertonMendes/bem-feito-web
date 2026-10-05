import '@angular/compiler';
import { Injector, runInInjectionContext, signal } from '@angular/core';
import { describe, expect, it } from 'vitest';
import { CatalogImageRef } from '../../domain/models/image.model';
import { ImageStoragePort } from '../images/image-storage.port';
import { ImageService } from './image.service';

class FakeStorage extends ImageStoragePort {
  readonly enabled = false;
  readonly revision = signal(0);
  calls = 0;

  async resolve(): Promise<string | null> {
    this.calls++;
    return null;
  }

  async save(): Promise<CatalogImageRef> {
    this.calls++;
    throw new Error('indisponível');
  }

  async remove(): Promise<void> {
    this.calls++;
  }
}

describe('ImageService', () => {
  it('delegates to the configured storage provider', async () => {
    const storage = new FakeStorage();
    const injector = Injector.create({ providers: [{ provide: ImageStoragePort, useValue: storage }] });
    const service = runInInjectionContext(injector, () => new ImageService());
    expect(service.enabled).toBe(false);
    expect(await service.resolve()).toBeNull();
    expect(storage.calls).toBe(1);
    injector.destroy();
  });
});
