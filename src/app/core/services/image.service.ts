import { inject, Injectable } from '@angular/core';
import { deleteObject, getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { FIREBASE_STORAGE } from '../firebase/firebase.providers';

@Injectable({ providedIn: 'root' })
export class ImageService {
  private readonly storage = inject(FIREBASE_STORAGE);
  private readonly urlCache = new Map<string, string>();

  async resolve(path?: string): Promise<string | null> {
    if (!path) return null;
    const cached = this.urlCache.get(path);
    if (cached) return cached;
    const url = await getDownloadURL(ref(this.storage, path));
    this.urlCache.set(path, url);
    return url;
  }

  async uploadCatalogImage(kind: 'products' | 'kits' | 'additions', id: string, file: File): Promise<string> {
    if (!file.type.startsWith('image/')) throw new Error('Selecione uma imagem válida.');
    if (file.size > 12 * 1024 * 1024) throw new Error('A imagem original deve ter no máximo 12 MB.');
    const blob = await this.toWebp(file);
    if (blob.size > 3 * 1024 * 1024) throw new Error('A imagem processada ficou acima do limite de 3 MB.');
    const path = `catalog/${kind}/${id}/cover.webp`;
    await uploadBytes(ref(this.storage, path), blob, { contentType: 'image/webp', cacheControl: 'public,max-age=31536000' });
    this.urlCache.delete(path);
    return path;
  }

  async remove(path?: string): Promise<void> {
    if (!path) return;
    await deleteObject(ref(this.storage, path));
    this.urlCache.delete(path);
  }

  private async toWebp(file: File): Promise<Blob> {
    const bitmap = await createImageBitmap(file);
    try {
      const maxDimension = 1200;
      const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Não foi possível processar a imagem.');
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      return await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Não foi possível converter a imagem.')), 'image/webp', 0.82);
      });
    } finally {
      bitmap.close();
    }
  }
}
