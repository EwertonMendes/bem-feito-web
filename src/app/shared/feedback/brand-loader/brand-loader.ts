import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { ThemeService } from '../../../core/services/theme.service';

@Component({
  selector: 'bf-brand-loader',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="brand-loader" [class.leaving]="leaving()" role="status" aria-live="polite" aria-label="Preparando seu espaço">
      <div class="ambient ambient-one"></div>
      <div class="ambient ambient-two"></div>
      <div class="ambient ambient-three"></div>

      <div class="loader-stage" aria-hidden="true">
        <div class="orbit orbit-outer"><i></i><i></i><i></i></div>
        <div class="orbit orbit-inner"></div>
        <div class="logo-shell">
          <span class="logo-glow"></span>
          <img
            [src]="theme.darkMode() ? '/assets/brand/bem-feito-logo-dark.webp' : '/assets/brand/bem-feito-logo-light.webp'"
            width="208"
            height="208"
            alt=""
          />
        </div>
      </div>

      <div class="loader-copy">
        <strong>Preparando seu espaço…</strong>
        <span>Organizando as informações da Bem Feito</span>
      </div>

      <div class="loading-rail" aria-hidden="true"><span></span></div>
    </div>
  `,
  styles: [`
    :host {
      position: fixed;
      inset: 0;
      z-index: 1000;
      display: block;
      pointer-events: all;
    }

    .brand-loader {
      position: absolute;
      inset: 0;
      overflow: hidden;
      display: grid;
      place-content: center;
      justify-items: center;
      gap: 22px;
      background:
        radial-gradient(circle at 50% 42%, color-mix(in srgb, var(--brand-soft) 58%, transparent) 0, transparent 31%),
        radial-gradient(circle at 18% 22%, color-mix(in srgb, var(--accent-soft) 30%, transparent) 0, transparent 26%),
        radial-gradient(circle at 82% 78%, color-mix(in srgb, var(--sand-soft) 32%, transparent) 0, transparent 30%),
        var(--bg);
      opacity: 1;
      transform: scale(1);
      transition: opacity 240ms ease, transform 260ms ease, filter 260ms ease;
    }

    .brand-loader.leaving {
      opacity: 0;
      transform: scale(1.012);
      filter: blur(2px);
      pointer-events: none;
    }

    .ambient {
      position: absolute;
      border-radius: 999px;
      filter: blur(2px);
      opacity: .55;
      animation: ambient-float 7s ease-in-out infinite;
    }

    .ambient-one {
      width: 150px;
      height: 150px;
      left: 12%;
      top: 18%;
      background: color-mix(in srgb, var(--brand) 12%, transparent);
    }

    .ambient-two {
      width: 105px;
      height: 105px;
      right: 15%;
      top: 24%;
      background: color-mix(in srgb, var(--accent) 10%, transparent);
      animation-delay: -2.4s;
    }

    .ambient-three {
      width: 190px;
      height: 190px;
      right: 18%;
      bottom: 11%;
      background: color-mix(in srgb, var(--sand) 10%, transparent);
      animation-delay: -4.3s;
    }

    .loader-stage {
      position: relative;
      width: 190px;
      height: 190px;
      display: grid;
      place-items: center;
    }

    .logo-shell {
      position: relative;
      z-index: 2;
      width: 118px;
      height: 118px;
      display: grid;
      place-items: center;
      border: 1px solid color-mix(in srgb, var(--brand) 28%, var(--line));
      border-radius: 50%;
      background: color-mix(in srgb, var(--surface) 82%, transparent);
      box-shadow:
        0 22px 65px color-mix(in srgb, var(--brand) 14%, transparent),
        inset 0 0 0 1px color-mix(in srgb, var(--surface-elevated) 55%, transparent);
      backdrop-filter: blur(16px);
      animation: logo-breathe 3.2s ease-in-out infinite;
    }

    .logo-shell img {
      width: 102px;
      height: 102px;
      object-fit: contain;
    }

    .logo-glow {
      position: absolute;
      inset: -18px;
      border-radius: 50%;
      background: radial-gradient(circle, color-mix(in srgb, var(--brand) 18%, transparent), transparent 68%);
      z-index: -1;
    }

    .orbit {
      position: absolute;
      border-radius: 50%;
      border: 1px solid color-mix(in srgb, var(--brand) 26%, transparent);
    }

    .orbit-outer {
      inset: 0;
      animation: orbit-spin 8s linear infinite;
    }

    .orbit-inner {
      inset: 18px;
      border-color: color-mix(in srgb, var(--sand) 22%, transparent);
      border-style: dashed;
      animation: orbit-spin-reverse 12s linear infinite;
    }

    .orbit-outer i {
      position: absolute;
      width: 11px;
      height: 11px;
      border-radius: 50%;
      box-shadow: 0 0 20px currentColor;
    }

    .orbit-outer i:nth-child(1) {
      top: 19px;
      left: 28px;
      background: var(--brand);
      color: color-mix(in srgb, var(--brand) 42%, transparent);
    }

    .orbit-outer i:nth-child(2) {
      right: 8px;
      top: 86px;
      width: 8px;
      height: 8px;
      background: var(--accent);
      color: color-mix(in srgb, var(--accent) 42%, transparent);
    }

    .orbit-outer i:nth-child(3) {
      bottom: 18px;
      left: 55px;
      width: 9px;
      height: 9px;
      background: var(--sand);
      color: color-mix(in srgb, var(--sand) 42%, transparent);
    }

    .loader-copy {
      position: relative;
      z-index: 2;
      display: grid;
      gap: 6px;
      text-align: center;
    }

    .loader-copy strong {
      color: var(--text);
      font-size: 1rem;
      font-weight: 720;
      letter-spacing: -.02em;
    }

    .loader-copy span {
      color: var(--muted);
      font-size: .75rem;
      font-weight: 520;
    }

    .loading-rail {
      position: relative;
      width: 176px;
      height: 3px;
      overflow: hidden;
      border-radius: 999px;
      background: color-mix(in srgb, var(--line) 72%, transparent);
    }

    .loading-rail span {
      position: absolute;
      inset: 0 auto 0 0;
      width: 46%;
      border-radius: inherit;
      background: linear-gradient(90deg, var(--brand), var(--sand), var(--accent));
      box-shadow: 0 0 16px color-mix(in srgb, var(--brand) 28%, transparent);
      animation: rail-travel 1.55s cubic-bezier(.4,0,.2,1) infinite;
    }

    @keyframes orbit-spin { to { transform: rotate(360deg); } }
    @keyframes orbit-spin-reverse { to { transform: rotate(-360deg); } }
    @keyframes logo-breathe {
      0%, 100% { transform: scale(1); }
      50% { transform: scale(1.025); }
    }
    @keyframes rail-travel {
      0% { transform: translateX(-115%); }
      100% { transform: translateX(330%); }
    }
    @keyframes ambient-float {
      0%, 100% { transform: translate3d(0,0,0) scale(1); }
      50% { transform: translate3d(0,-12px,0) scale(1.06); }
    }

    @media (max-width: 640px) {
      .loader-stage { width: 166px; height: 166px; }
      .logo-shell { width: 108px; height: 108px; }
      .logo-shell img { width: 92px; height: 92px; }
    }
  `],
})
export class BrandLoader {
  readonly theme = inject(ThemeService);
  readonly leaving = input(false);
}
