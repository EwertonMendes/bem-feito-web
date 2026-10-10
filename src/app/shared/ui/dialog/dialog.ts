import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, ElementRef, OnDestroy, effect, inject, input } from '@angular/core';

@Component({
  selector: 'dialog[bfDialog]',
  exportAs: 'bfDialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<ng-content />',
  host: {
    '(close)': 'handleNativeClose()',
    '(cancel)': 'onNativeCancel($event)',
    '[attr.aria-busy]': 'busy() ? "true" : null',
    '[class.bf-dialog-busy]': 'busy()',
  },
})
export class BfDialog implements OnDestroy {
  private static openModalCount = 0;

  private readonly element = inject<ElementRef<HTMLDialogElement>>(ElementRef);
  private readonly document = inject(DOCUMENT);
  private scrollLocked = false;

  /** Trava a interface durante gravações assíncronas. */
  readonly busy = input(false);

  constructor() {
    effect(() => {
      const locked = this.busy();
      // Inert desativa toda a interação dos filhos sem desmontar o modal ou alterar seus dados.
      for (const child of Array.from(this.element.nativeElement.children)) {
        if (child instanceof HTMLElement) child.inert = locked;
      }
    });
  }

  onNativeCancel(event: Event): void {
    if (this.busy()) event.preventDefault();
  }

  open(): void {
    const dialog = this.element.nativeElement;
    if (dialog.open) return;

    dialog.showModal();
    this.lockPageScroll();
  }

  close(returnValue?: string): void {
    if (this.busy()) return;
    this.closeNative(returnValue);
  }

  /** Explicitamente usado após confirmação de sucesso da operação, mesmo com busy ativo. */
  closeAfterSuccess(): void {
    this.closeNative();
  }

  private closeNative(returnValue?: string): void {
    const dialog = this.element.nativeElement;
    if (dialog.open) dialog.close(returnValue);
  }

  handleNativeClose(): void {
    this.releasePageScroll();
  }

  ngOnDestroy(): void {
    for (const child of Array.from(this.element.nativeElement.children)) {
      if (child instanceof HTMLElement) child.inert = false;
    }
    this.releasePageScroll();
  }

  private lockPageScroll(): void {
    if (this.scrollLocked) return;

    this.scrollLocked = true;
    BfDialog.openModalCount += 1;
    this.document.documentElement.classList.add('bf-modal-open');
  }

  private releasePageScroll(): void {
    if (!this.scrollLocked) return;

    this.scrollLocked = false;
    BfDialog.openModalCount = Math.max(0, BfDialog.openModalCount - 1);

    if (BfDialog.openModalCount === 0) {
      this.document.documentElement.classList.remove('bf-modal-open');
    }
  }
}
