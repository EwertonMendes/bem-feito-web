import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, ElementRef, OnDestroy, inject } from '@angular/core';

@Component({
  selector: 'dialog[bfDialog]',
  exportAs: 'bfDialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<ng-content />',
  host: {
    '(close)': 'handleNativeClose()',
  },
})
export class BfDialog implements OnDestroy {
  private static openModalCount = 0;

  private readonly element = inject<ElementRef<HTMLDialogElement>>(ElementRef);
  private readonly document = inject(DOCUMENT);
  private scrollLocked = false;

  open(): void {
    const dialog = this.element.nativeElement;
    if (dialog.open) return;

    dialog.showModal();
    this.lockPageScroll();
  }

  close(returnValue?: string): void {
    const dialog = this.element.nativeElement;
    if (dialog.open) dialog.close(returnValue);
  }

  handleNativeClose(): void {
    this.releasePageScroll();
  }

  ngOnDestroy(): void {
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
