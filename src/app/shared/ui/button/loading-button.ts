import { Directive, input } from '@angular/core';

/**
 * Estado visual de ações assíncronas no design system.
 * Os consumidores devem manter [disabled] e uma guarda síncrona no handler.
 */
@Directive({
  selector: 'button[bfLoadingButton]',
  host: {
    '[class.bf-button-loading]': 'bfLoadingButton()',
    '[attr.aria-busy]': 'bfLoadingButton() ? "true" : null',
  },
})
export class BfLoadingButton {
  readonly bfLoadingButton = input(false);
}
