import { Injectable } from '@angular/core';

export interface ProcessedImage {
  blob: Blob;
  width: number;
  height: number;
}

@Injectable({ providedIn: 'root' })
export class ImageProcessorService {
  private readonly acceptedTypes = new Set(['image/webp', 'image/png', 'image/jpeg', 'image/gif', 'image/avif']);

  async process(file: File): Promise<ProcessedImage> {
    if (!this.acceptedTypes.has(file.type)) throw new Error('Selecione uma imagem WebP, PNG, JPEG, GIF ou AVIF.');
    if (file.size > 12 * 1024 * 1024) throw new Error('A imagem original deve ter no máximo 12 MB.');

    const source = await this.loadSource(file);
    try {
      const maxDimension = 1200;
      const scale = Math.min(1, maxDimension / Math.max(source.width, source.height));
      const width = Math.max(1, Math.round(source.width * scale));
      const height = Math.max(1, Math.round(source.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Não foi possível processar a imagem.');
      context.drawImage(source.image, 0, 0, width, height);
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (value) => value?.type === 'image/webp' ? resolve(value) : reject(new Error('Este navegador não conseguiu converter a imagem para WebP.')),
          'image/webp',
          0.82,
        );
      });
      if (blob.size > 3 * 1024 * 1024) throw new Error('A imagem processada ficou acima do limite de 3 MB.');
      return { blob, width, height };
    } finally {
      source.dispose();
    }
  }

  private async loadSource(file: File): Promise<{ image: CanvasImageSource; width: number; height: number; dispose: () => void }> {
    if ('createImageBitmap' in window) {
      const bitmap = await createImageBitmap(file);
      return { image: bitmap, width: bitmap.width, height: bitmap.height, dispose: () => bitmap.close() };
    }

    const url = URL.createObjectURL(file);
    const image = new Image();
    image.decoding = 'async';
    image.src = url;
    try {
      await image.decode();
      return { image, width: image.naturalWidth, height: image.naturalHeight, dispose: () => URL.revokeObjectURL(url) };
    } catch (error) {
      URL.revokeObjectURL(url);
      throw error;
    }
  }
}
