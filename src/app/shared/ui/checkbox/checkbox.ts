import { ChangeDetectionStrategy, Component, ElementRef, input, model, output, viewChild } from '@angular/core';
import { FormCheckboxControl } from '@angular/forms/signals';
import { BfIcon } from '../icon/icon';

@Component({
  selector: 'bf-checkbox',
  imports: [BfIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './checkbox.html',
  styleUrl: './checkbox.scss',
})
export class BfCheckbox implements FormCheckboxControl {
  private readonly inputElement = viewChild.required<ElementRef<HTMLInputElement>>('native');

  readonly checked = model(false);
  readonly label = input('');
  readonly description = input('');
  readonly ariaLabel = input('Opção');
  readonly disabled = input(false);
  readonly required = input(false);
  readonly invalid = input(false);
  readonly touch = output<void>();

  focus(options?: FocusOptions): void {
    this.inputElement().nativeElement.focus(options);
  }
}
