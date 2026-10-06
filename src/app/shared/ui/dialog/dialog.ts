import { ChangeDetectionStrategy, Component, ElementRef, inject } from '@angular/core';

@Component({
  selector: 'dialog[bfDialog]',
  exportAs: 'bfDialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<ng-content />',
})
export class BfDialog {
  private readonly element = inject<ElementRef<HTMLDialogElement>>(ElementRef);

  open(): void {
    const dialog = this.element.nativeElement;
    if (!dialog.open) dialog.showModal();
  }

  close(returnValue?: string): void {
    const dialog = this.element.nativeElement;
    if (dialog.open) dialog.close(returnValue);
  }
}
