import { describe, expect, it } from 'vitest';
import { allocatePayments, paymentStatus } from './sale-calculations';

describe('sale calculations', () => {
  it('separa aplicado e gorjeta', () => {
    expect(allocatePayments(2500, [
      { methodId: 'pix', amountReceivedCents: 1000 },
      { methodId: 'cash', amountReceivedCents: 2000 },
    ])).toEqual([
      { methodId: 'pix', amountReceivedCents: 1000, appliedCents: 1000, tipCents: 0 },
      { methodId: 'cash', amountReceivedCents: 2000, appliedCents: 1500, tipCents: 500 },
    ]);
  });

  it('deriva status', () => {
    expect(paymentStatus(1000, 0)).toBe('pending');
    expect(paymentStatus(1000, 400)).toBe('partial');
    expect(paymentStatus(1000, 1000)).toBe('paid');
  });
});
