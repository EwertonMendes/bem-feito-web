import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { BfIcon } from '../icon/icon';

@Component({
  selector: 'bf-image-frame',
  imports: [BfIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="frame" [class.compact]="compact()" [class.contain]="fit() === 'contain'" [attr.aria-busy]="loading()">
      @if (src()) {
        <img [src]="src()!" [alt]="alt()" loading="lazy" />
      } @else if (loading()) {
        <span class="skeleton" aria-hidden="true"></span>
      } @else {
        <bf-icon name="image" />
      }
    </div>
  `,
  styles: [`
    :host{display:block;min-width:0;min-height:0}.frame{position:relative;aspect-ratio:4/3;border-radius:14px;display:grid;place-items:center;overflow:hidden;background:linear-gradient(145deg,var(--surface-2),var(--brand-soft));color:var(--muted)}
    .frame.compact{width:48px;height:48px;aspect-ratio:1;border-radius:12px}.frame img{width:100%;height:100%;object-fit:cover}.frame.contain{width:100%;height:100%;aspect-ratio:auto}.frame.contain img{position:absolute;inset:5px;width:calc(100% - 10px);height:calc(100% - 10px);min-width:0;min-height:0;max-width:none;max-height:none;object-fit:contain!important;object-position:center}.frame bf-icon{width:28px;height:28px}
    .skeleton{position:absolute;inset:0;background:linear-gradient(100deg,var(--surface-2) 20%,color-mix(in srgb,var(--surface-2) 70%,white) 38%,var(--surface-2) 56%);background-size:220% 100%;animation:image-loading 1.15s ease-in-out infinite}
    @keyframes image-loading{from{background-position:120% 0}to{background-position:-100% 0}}@media(prefers-reduced-motion:reduce){.skeleton{animation:none}}
  `],
})
export class BfImageFrame {
  readonly src = input<string | null>(null);
  readonly alt = input('Imagem');
  readonly loading = input(false);
  readonly compact = input(false);
  readonly fit = input<'cover' | 'contain'>('cover');
}
