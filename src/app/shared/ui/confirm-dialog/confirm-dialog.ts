import { ChangeDetectionStrategy, Component, signal, viewChild } from '@angular/core';
import { BfDialog } from '../dialog/dialog';
import { BfIcon, BfIconName } from '../icon/icon';

export interface BfConfirmDialogOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'primary' | 'danger';
  icon?: BfIconName;
}

const DEFAULT_OPTIONS: Required<Omit<BfConfirmDialogOptions, 'icon'>> & { icon: BfIconName } = {
  title: 'Confirmar ação',
  message: '',
  confirmLabel: 'Confirmar',
  cancelLabel: 'Cancelar',
  tone: 'primary',
  icon: 'alert',
};

@Component({
  selector: 'bf-confirm-dialog',
  imports: [BfDialog, BfIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './confirm-dialog.html',
  styleUrl: './confirm-dialog.scss',
})
export class BfConfirmDialog {
  private readonly dialog = viewChild.required<BfDialog>('dialog');
  private resolver?: (confirmed: boolean) => void;

  readonly options = signal(DEFAULT_OPTIONS);

  open(options: BfConfirmDialogOptions): Promise<boolean> {
    if (this.resolver) {
      this.finish(false);
    }

    this.options.set({ ...DEFAULT_OPTIONS, ...options });
    this.dialog().open();

    return new Promise<boolean>((resolve) => {
      this.resolver = resolve;
    });
  }

  confirm(): void {
    this.finish(true);
  }

  cancel(): void {
    this.finish(false);
  }

  onNativeCancel(event: Event): void {
    event.preventDefault();
    this.finish(false);
  }

  private finish(confirmed: boolean): void {
    const resolve = this.resolver;
    this.resolver = undefined;
    this.dialog().close();
    resolve?.(confirmed);
  }
}
