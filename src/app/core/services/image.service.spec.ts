import '@angular/compiler';
import { Injector, runInInjectionContext } from '@angular/core';
import { describe, expect, it } from 'vitest';
import { FIREBASE_STORAGE } from '../firebase/firebase.providers';
import { ImageService } from './image.service';

describe('Catalog without an image provider', () => {
  it('does not initialize Storage even when a record has a saved image path', async () => {
    let storageRequests = 0;
    const injector = Injector.create({ providers: [{
      provide: FIREBASE_STORAGE,
      useFactory: () => { storageRequests++; throw new Error('Storage unavailable'); },
    }] });
    const service = runInInjectionContext(injector, () => new ImageService());
    expect(service.enabled).toBe(false);
    expect(await service.resolve()).toBeNull();
    expect(await service.resolve('catalog/products/existing/cover.webp')).toBeNull();
    await service.remove('catalog/products/existing/cover.webp');
    await expect(service.uploadCatalogImage('products', 'new', {} as File)).rejects.toThrow('indisponível');
    expect(storageRequests).toBe(0);
    injector.destroy();
  });
});
