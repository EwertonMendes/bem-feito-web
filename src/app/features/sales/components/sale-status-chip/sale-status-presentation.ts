import { FulfillmentStatus, PaymentStatus, Sale } from '../../../../domain/models/sales.model';
import { BfIconName } from '../../../../shared/ui/icon/icon';

export type SaleStatusKind = 'fulfillment' | 'payment';
export type SaleStatusTone = 'production' | 'ready' | 'delivered' | 'cancelled' |
  'paid' | 'partial' | 'pending' | 'not-applicable';

export interface SaleStatusPresentation {
  readonly label: string;
  readonly icon: BfIconName | null;
  readonly tone: SaleStatusTone;
}

const fulfillment: Record<FulfillmentStatus, SaleStatusPresentation> = {
  'in-production': { label: 'Em produção', icon: 'sale-in-production', tone: 'production' },
  ready: { label: 'Pronto', icon: 'sale-ready', tone: 'ready' },
  delivered: { label: 'Entregue', icon: 'sale-delivered', tone: 'delivered' },
};

const payment: Record<PaymentStatus, SaleStatusPresentation> = {
  paid: { label: 'Pago', icon: 'sale-paid', tone: 'paid' },
  partial: { label: 'Parcial', icon: 'sale-partial', tone: 'partial' },
  pending: { label: 'Pendente', icon: 'sale-pending', tone: 'pending' },
  cancelled: { label: 'Cancelado', icon: 'sale-cancelled', tone: 'cancelled' },
};

const cancelled: SaleStatusPresentation = {
  label: 'Cancelada', icon: 'sale-cancelled', tone: 'cancelled',
};
const notApplicable: SaleStatusPresentation = {
  label: '—', icon: null, tone: 'not-applicable',
};

/** Pure UI projection: never derives fulfillment from payment or changes a sale. */
export function saleStatusPresentation(
  sale: Pick<Sale, 'status' | 'fulfillmentStatus' | 'paymentStatus'>,
  kind: SaleStatusKind,
): SaleStatusPresentation {
  if (kind === 'fulfillment') {
    if (sale.status === 'cancelled') return cancelled;
    // Legacy sales have no fulfillmentStatus and are considered delivered.
    return fulfillment[sale.fulfillmentStatus ?? 'delivered'];
  }
  // A cancelled sale's payment/chargeback detail remains in the sale history.
  if (sale.status === 'cancelled') return notApplicable;
  return payment[sale.paymentStatus];
}
