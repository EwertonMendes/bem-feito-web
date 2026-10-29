import { PaymentDraft } from '../../domain/models/sales.model';

export interface PaymentAllocation {
  methodId: string;
  amountReceivedCents: number;
  appliedCents: number;
  tipCents: number;
}

export function allocatePayments(totalCents: number, payments: PaymentDraft[]): PaymentAllocation[] {
  let remaining = Math.max(0, totalCents);
  return payments
    .filter((payment) => payment.amountReceivedCents > 0 && payment.methodId)
    .map((payment) => {
      const received = Math.max(0, Math.round(payment.amountReceivedCents));
      const applied = Math.min(remaining, received);
      const tip = Math.max(0, received - applied);
      remaining -= applied;
      return { methodId: payment.methodId, amountReceivedCents: received, appliedCents: applied, tipCents: tip };
    });
}

export { paymentStatus } from '../../domain/logic/sale-pricing';
