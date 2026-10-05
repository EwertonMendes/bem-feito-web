import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ToastService } from '../../../core/services/toast.service';

@Component({
  selector: 'bf-toast-container',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="stack" aria-live="polite">
      @for (toast of service.messages(); track toast.id) {
        <button type="button" class="toast" [class]="toast.kind" (click)="service.dismiss(toast.id)">
          <span class="dot"></span><span>{{ toast.message }}</span>
        </button>
      }
    </div>
  `,
  styles: [`
    .stack{position:fixed;right:18px;bottom:18px;z-index:1000;display:grid;gap:10px;width:min(420px,calc(100vw - 36px))}
    .toast{display:grid;grid-template-columns:10px 1fr;gap:10px;align-items:center;text-align:left;border:1px solid var(--line);border-radius:14px;background:var(--surface);color:var(--text);padding:14px 16px;box-shadow:var(--shadow);font-weight:700}
    .dot{width:8px;height:8px;border-radius:50%;background:var(--brand)}.toast.error .dot{background:var(--danger)}.toast.success .dot{background:var(--success)}
    @media(max-width:640px){.stack{bottom:88px}}
  `],
})
export class ToastContainer {
  readonly service = inject(ToastService);
}
