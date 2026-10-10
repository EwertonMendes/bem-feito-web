import { ChangeDetectionStrategy, Component, ElementRef, effect, inject, viewChild } from '@angular/core';
import { ToastMessage, ToastService } from '../../core/services/toast.service';
import { BfIcon, BfIconName } from '../ui/icon/icon';

@Component({
  selector: 'bf-toast-container',
  imports: [BfIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div #stack class="stack" popover="manual" aria-live="polite" aria-label="Notificações">
      @for (toast of service.messages(); track toast.id) {
        <article
          class="toast"
          [class.success]="toast.kind === 'success'"
          [class.error]="toast.kind === 'error'"
          [class.info]="toast.kind === 'info'"
          [attr.role]="toast.kind === 'error' ? 'alert' : 'status'"
        >
          <span class="toast-icon" aria-hidden="true"><bf-icon [name]="icon(toast.kind)" /></span>
          <span class="message">{{ toast.message }}</span>
          <button type="button" class="dismiss" aria-label="Fechar notificação" (click)="service.dismiss(toast.id)">
            <bf-icon name="close" />
          </button>
        </article>
      }
    </div>
  `,
  styles: [`
    :host{position:relative;z-index:1200}
    .stack{position:fixed;inset:auto auto max(20px,env(safe-area-inset-bottom)) 50%;margin:0;padding:0;border:0;background:transparent;overflow:visible;z-index:1200;width:min(560px,calc(100vw - 32px));display:grid;gap:10px;transform:translateX(-50%);pointer-events:none}
    .toast{pointer-events:auto;min-width:0;display:grid;grid-template-columns:36px minmax(0,1fr) 32px;gap:11px;align-items:center;padding:11px 11px 11px 13px;border:1px solid color-mix(in srgb,var(--line) 76%,var(--brand) 24%);border-radius:16px;background:color-mix(in srgb,var(--surface-elevated) 94%,transparent);color:var(--text);box-shadow:0 18px 52px rgba(20,15,12,.22);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);animation:toast-in 180ms ease-out}
    .toast.success{border-color:color-mix(in srgb,var(--success) 30%,var(--line))}
    .toast.error{border-color:color-mix(in srgb,var(--danger) 36%,var(--line))}
    .toast.info{border-color:color-mix(in srgb,var(--brand) 32%,var(--line))}
    .toast-icon{width:36px;height:36px;display:grid;place-items:center;border-radius:11px;color:var(--brand-strong);background:var(--brand-soft)}
    .toast.success .toast-icon{color:var(--success);background:var(--success-soft)}
    .toast.error .toast-icon{color:var(--danger);background:var(--danger-soft)}
    .toast-icon bf-icon{width:19px;height:19px}
    .message{min-width:0;font-size:.86rem;font-weight:650;line-height:1.4;overflow-wrap:anywhere}
    .dismiss{width:32px;height:32px;display:grid;place-items:center;padding:0;border:0;border-radius:9px;background:transparent;color:var(--muted);transition:background 140ms ease,color 140ms ease}
    .dismiss:hover{background:var(--surface-2);color:var(--text)}
    .dismiss bf-icon{width:17px;height:17px}
    @keyframes toast-in{from{opacity:0;transform:translateY(10px) scale(.985)}to{opacity:1;transform:translateY(0) scale(1)}}
    @media(max-width:640px){.stack{width:calc(100vw - 24px);bottom:calc(82px + env(safe-area-inset-bottom))}}
    @media(prefers-reduced-motion:reduce){.toast{animation:none}}
  `],
})
export class ToastContainer {
  readonly service = inject(ToastService);
  private readonly stack = viewChild<ElementRef<HTMLDivElement>>('stack');

  constructor() {
    effect(() => {
      const hasMessages = this.service.messages().length > 0;
      const stack = this.stack()?.nativeElement;
      if (!stack) return;

      if (hasMessages && !stack.matches(':popover-open')) stack.showPopover();
      if (!hasMessages && stack.matches(':popover-open')) stack.hidePopover();
    });
  }

  icon(kind: ToastMessage['kind']): BfIconName {
    if (kind === 'success') return 'check';
    if (kind === 'error') return 'alert';
    return 'info';
  }
}
