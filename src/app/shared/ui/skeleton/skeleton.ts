import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

@Component({
  selector: 'bf-skeleton',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'aria-hidden': 'true' },
  template: `
    <span
      class="skeleton"
      [class.circle]="shape() === 'circle'"
      [style.width]="width()"
      [style.height]="height()"
      [style.border-radius]="shape() === 'circle' ? '999px' : radius()"
    ></span>
  `,
  styles: [`
    :host { display: block; min-width: 0; }
    .skeleton {
      position: relative;
      display: block;
      max-width: 100%;
      overflow: hidden;
      background: color-mix(in srgb, var(--surface-2) 82%, var(--surface));
      border: 1px solid color-mix(in srgb, var(--line) 58%, transparent);
    }
    .skeleton::after {
      content: "";
      position: absolute;
      inset: 0;
      transform: translateX(-110%);
      background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--surface-elevated) 62%, transparent), color-mix(in srgb, var(--brand-soft) 36%, transparent), transparent);
      animation: bf-skeleton-shimmer 1.35s ease-in-out infinite;
    }
    @keyframes bf-skeleton-shimmer { to { transform: translateX(110%); } }
  `],
})
export class BfSkeleton {
  readonly width = input('100%');
  readonly height = input('14px');
  readonly radius = input('8px');
  readonly shape = input<'block' | 'circle'>('block');
}

@Component({
  selector: 'bf-table-skeleton',
  imports: [BfSkeleton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'aria-busy': 'true', 'aria-label': 'Carregando dados' },
  template: `
    <div class="frame" [style.--skeleton-columns]="columns()">
      <div class="head">
        @for (cell of columnItems(); track cell) {
          <bf-skeleton height="10px" width="62%" radius="5px" />
        }
      </div>
      @for (row of rowItems(); track row) {
        <div class="row">
          @for (cell of columnItems(); track cell) {
            <bf-skeleton height="14px" [width]="cell % 3 === 0 ? '54%' : cell % 2 === 0 ? '76%' : '88%'" />
          }
        </div>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }
    .frame {
      overflow: hidden;
      border: 1px solid var(--line);
      border-radius: var(--radius);
      background: var(--surface);
      box-shadow: var(--shadow-sm);
    }
    .head, .row {
      display: grid;
      grid-template-columns: repeat(var(--skeleton-columns), minmax(80px, 1fr));
      gap: 14px;
      align-items: center;
      padding: 14px 17px;
    }
    .head {
      background: color-mix(in srgb, var(--surface-2) 58%, var(--surface));
      border-bottom: 1px solid var(--line);
    }
    .row {
      min-height: 56px;
      border-bottom: 1px solid var(--line);
    }
    .row:last-child { border-bottom: 0; }
    @media (max-width: 820px) {
      .head { display: none; }
      .row {
        grid-template-columns: 42px minmax(0, 1fr) 72px;
        min-height: 76px;
        gap: 12px;
      }
      .row > :nth-child(n+4) { display: none; }
    }
  `],
})
export class BfTableSkeleton {
  readonly rows = input(7);
  readonly columns = input(6);
  readonly rowItems = computed(() => Array.from({ length: Math.max(1, this.rows()) }, (_, index) => index));
  readonly columnItems = computed(() => Array.from({ length: Math.max(1, this.columns()) }, (_, index) => index));
}

@Component({
  selector: 'bf-list-skeleton',
  imports: [BfSkeleton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'aria-busy': 'true', 'aria-label': 'Carregando dados' },
  template: `
    <div class="list">
      @for (row of rowItems(); track row) {
        <div class="row">
          <bf-skeleton shape="circle" width="42px" height="42px" />
          <div class="copy">
            <bf-skeleton width="58%" height="14px" />
            <bf-skeleton width="36%" height="10px" radius="5px" />
          </div>
          <div class="meta">
            <bf-skeleton width="64px" height="15px" />
            <bf-skeleton width="48px" height="10px" radius="5px" />
          </div>
          <bf-skeleton class="action" width="86px" height="38px" radius="11px" />
        </div>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }
    .list { display: grid; gap: 9px; }
    .row {
      min-height: 68px;
      display: grid;
      grid-template-columns: 42px minmax(0,1fr) 110px 86px;
      gap: 14px;
      align-items: center;
      padding: 12px 14px;
      border: 1px solid var(--line);
      border-radius: 15px;
      background: var(--surface);
    }
    .copy, .meta { display: grid; gap: 7px; min-width: 0; }
    .meta { justify-items: end; }
    @media (max-width: 640px) {
      .row { grid-template-columns: 42px minmax(0,1fr) 72px; }
      .action { display: none; }
      .meta { justify-items: end; }
    }
  `],
})
export class BfListSkeleton {
  readonly rows = input(7);
  readonly rowItems = computed(() => Array.from({ length: Math.max(1, this.rows()) }, (_, index) => index));
}
