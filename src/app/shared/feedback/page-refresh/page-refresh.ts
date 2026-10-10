import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'bf-page-refresh',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="refresh" role="status" aria-live="polite">
      <span class="sr-only">{{ label() }}</span>
      <i aria-hidden="true"></i>
    </div>
  `,
  styles: [`
    :host {
      position: absolute;
      inset: 0 0 auto;
      z-index: 8;
      display: block;
      height: 3px;
      pointer-events: none;
      overflow: hidden;
      border-radius: 999px;
    }
    .refresh {
      position: absolute;
      inset: 0;
      overflow: hidden;
      background: color-mix(in srgb, var(--line) 46%, transparent);
    }
    .refresh i {
      position: absolute;
      inset: 0 auto 0 0;
      width: 34%;
      border-radius: inherit;
      background: linear-gradient(90deg, var(--brand), var(--sand), var(--accent));
      box-shadow: 0 0 12px color-mix(in srgb, var(--brand) 24%, transparent);
      animation: bf-page-refresh 1.2s cubic-bezier(.4,0,.2,1) infinite;
    }
    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0,0,0,0);
      white-space: nowrap;
      border: 0;
    }
    @keyframes bf-page-refresh {
      0% { transform: translateX(-120%); }
      100% { transform: translateX(400%); }
    }
  `],
})
export class BfPageRefresh {
  readonly label = input('Atualizando dados');
}
