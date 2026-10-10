import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, effect, inject, input, signal } from '@angular/core';
import { ImageService } from '../../../core/services/image.service';
import { CatalogImageRef } from '../../../domain/models/image.model';
import { BfImageFrame } from '../../ui/image-frame/image-frame';

@Component({
  selector: 'bf-catalog-image',
  imports: [BfImageFrame],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<bf-image-frame [src]="url()" [alt]="alt()" [loading]="loading()" [compact]="compact()" [fit]="fit()" />`,
})
export class CatalogImage {
  private readonly images = inject(ImageService);
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly destroyRef = inject(DestroyRef);
  private readonly visible = signal(false);
  private request = 0;

  readonly image = input<CatalogImageRef | undefined>();
  readonly alt = input('Imagem do item');
  readonly compact = input(false);
  readonly fit = input<'cover' | 'contain'>('cover');
  readonly url = signal<string | null>(null);
  readonly loading = signal(false);

  constructor() {
    afterNextRender(() => {
      if (!('IntersectionObserver' in window)) {
        this.visible.set(true);
        return;
      }
      const observer = new IntersectionObserver((entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        this.visible.set(true);
        observer.disconnect();
      }, { rootMargin: '240px' });
      observer.observe(this.host.nativeElement);
      this.destroyRef.onDestroy(() => observer.disconnect());
    });

    effect(() => {
      const image = this.image();
      const visible = this.visible();
      const availability = this.images.availability();
      this.images.revision();
      const request = ++this.request;
      this.url.set(null);

      if (!image) {
        this.loading.set(false);
        return;
      }

      if (!visible || availability === 'loading') {
        this.loading.set(true);
        return;
      }

      if (availability !== 'available') {
        this.loading.set(false);
        return;
      }

      this.loading.set(true);
      void this.images.resolve(image).then((url) => {
        if (request !== this.request) return;
        this.url.set(url);
        this.loading.set(false);
      }).catch(() => {
        if (request !== this.request) return;
        this.url.set(null);
        this.loading.set(false);
      });
    });
  }
}
