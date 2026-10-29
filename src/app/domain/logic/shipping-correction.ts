import { Sale } from '../models/sales.model';
import { calculateSaleTotalCents, paymentStatus } from './sale-pricing';

export interface ShippingCorrectionDraft {
  shippingFeeCents: number;
  reclassifyTip: boolean;
  expectedSignature: string;
  reason: string;
}

export function shippingCorrectionSignature(sale: Sale): string {
  return JSON.stringify({
    id: sale.id, status: sale.status, subtotalCents: sale.subtotalCents,
    discountCents: sale.discountCents, shippingFeeCents: sale.shippingFeeCents ?? 0,
    totalCents: sale.totalCents, receivedCents: sale.receivedCents,
    tipCents: sale.tipCents, balanceCents: sale.balanceCents,
    paymentIds: sale.paymentIds,
  });
}

export function planShippingCorrection(sale: Sale, feeCents: number, reclassifyTip: boolean) {
  if (sale.status !== 'active') throw new Error('Venda cancelada não pode ser corrigida.');
  const previousFee = sale.shippingFeeCents ?? 0;
  if (sale.totalCents !== calculateSaleTotalCents(sale.subtotalCents, sale.discountCents, previousFee))
    throw new Error('Total histórico inconsistente; concilie antes de editar.');
  const totalCents = calculateSaleTotalCents(sale.subtotalCents, sale.discountCents, feeCents);
  if (previousFee === feeCents) throw new Error('O frete não mudou.');
  const delta = feeCents - previousFee;
  if (reclassifyTip && (delta <= 0 || sale.tipCents < delta))
    throw new Error('A gorjeta registrada não cobre o aumento do frete.');
  const reclassifiedCents = reclassifyTip ? delta : 0;
  const receivedCents = sale.receivedCents + reclassifiedCents;
  if (receivedCents > totalCents) throw new Error('O total seria menor que o valor recebido.');
  const balanceCents = totalCents - receivedCents;
  if (balanceCents > 0 && !sale.customerName?.trim())
    throw new Error('Informe o cliente para manter saldo a receber.');
  return { totalCents, receivedCents, balanceCents, tipCents: sale.tipCents - reclassifiedCents,
    paymentStatus: paymentStatus(totalCents, receivedCents), reclassifiedCents };
}
