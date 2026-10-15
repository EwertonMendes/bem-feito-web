import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { Sale } from '../../../../domain/models/sales.model';
import { BfIcon } from '../../../../shared/ui/icon/icon';
import { SaleStatusKind, saleStatusPresentation } from './sale-status-presentation';

/** Compact, non-interactive status chip, shared by table and mobile sales cards. */
@Component({
  selector: 'bf-sale-status-chip',
  imports: [BfIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (presentation().tone === 'not-applicable') {
      <span class="status-not-applicable" title="Pagamento não aplicável a venda cancelada">—</span>
    } @else {
      <span class="sale-status-chip" [attr.data-tone]="presentation().tone">
        @if (presentation().icon; as icon) {
          <bf-icon [name]="icon" />
        }
        <span>{{ presentation().label }}</span>
      </span>
    }
  `,
  styleUrl: './sale-status-chip.scss',
})
export class BfSaleStatusChip {
  readonly sale = input.required<Sale>();
  readonly kind = input.required<SaleStatusKind>();
  readonly presentation = computed(() => saleStatusPresentation(this.sale(), this.kind()));
}
