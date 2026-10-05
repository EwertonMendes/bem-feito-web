import { ChangeDetectionStrategy, Component, effect, inject, input, signal } from '@angular/core';
import { ImageService } from '../../../core/services/image.service';
import { BfIcon } from '../icon/icon';

@Component({
  selector: 'bf-catalog-image',
  imports: [BfIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="frame" [class.compact]="compact()">
      @if (url()) { <img [src]="url()!" [alt]="alt()" loading="lazy" /> }
      @else { <bf-icon name="image" /> }
    </div>
  `,
  styles: [`
    :host{display:block}.frame{aspect-ratio:4/3;border-radius:14px;display:grid;place-items:center;overflow:hidden;background:linear-gradient(145deg,var(--surface-2),var(--brand-soft));color:var(--muted)}
    .frame.compact{width:48px;height:48px;aspect-ratio:1;border-radius:12px}.frame img{width:100%;height:100%;object-fit:cover}.frame bf-icon{width:28px;height:28px}
  `],
})
export class CatalogImage {
  private readonly images = inject(ImageService);
  private request = 0;
  readonly path = input<string | undefined>();
  readonly alt = input('Imagem do item');
  readonly compact = input(false);
  readonly url = signal<string | null>(null);

  constructor() {
    effect(() => {
      const path = this.path();
      const request = ++this.request;
      this.url.set(null);
      if (!path) return;
      void this.images.resolve(path).then((url) => {
        if (request === this.request) this.url.set(url);
      }).catch(() => {
        if (request === this.request) this.url.set(null);
      });
    });
  }
}
