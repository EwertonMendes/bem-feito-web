import { describe, expect, it } from 'vitest';
import { Sale } from '../../../../domain/models/sales.model';
import { saleStatusPresentation } from './sale-status-presentation';

type StatusFields = Pick<Sale, 'status' | 'fulfillmentStatus' | 'paymentStatus'>;

function sale(fields: Partial<StatusFields> = {}): StatusFields {
  return { status: 'active', fulfillmentStatus: 'delivered', paymentStatus: 'paid', ...fields };
}

describe('sale status chips', () => {
  it.each([
    ['in-production', 'Em produção', 'sale-in-production', 'production'],
    ['ready', 'Pronto', 'sale-ready', 'ready'],
    ['delivered', 'Entregue', 'sale-delivered', 'delivered'],
  ] as const)('displays fulfillment %s', (status, label, icon, tone) => {
    expect(saleStatusPresentation(sale({ fulfillmentStatus: status }), 'fulfillment')).toEqual({ label, icon, tone });
  });

  it.each([
    ['paid', 'Pago', 'sale-paid', 'paid'],
    ['partial', 'Parcial', 'sale-partial', 'partial'],
    ['pending', 'Pendente', 'sale-pending', 'pending'],
    ['cancelled', 'Cancelado', 'sale-cancelled', 'cancelled'],
  ] as const)('displays payment %s independently from fulfillment', (status, label, icon, tone) => {
    expect(saleStatusPresentation(sale({ paymentStatus: status, fulfillmentStatus: 'in-production' }), 'payment'))
      .toEqual({ label, icon, tone });
  });

  it('treats legacy fulfillment as delivered', () => {
    expect(saleStatusPresentation(sale({ fulfillmentStatus: undefined }), 'fulfillment').label).toBe('Entregue');
  });

  it('shows cancellation only in andamento and a dash in pagamento', () => {
    const cancelledSale = sale({ status: 'cancelled', paymentStatus: 'paid', fulfillmentStatus: 'ready' });
    expect(saleStatusPresentation(cancelledSale, 'fulfillment')).toEqual({
      label: 'Cancelada', icon: 'sale-cancelled', tone: 'cancelled',
    });
    expect(saleStatusPresentation(cancelledSale, 'payment')).toEqual({
      label: '—', icon: null, tone: 'not-applicable',
    });
  });
});
