import { BfIconName } from '../icon/icon';

export function paymentMethodIcon(name: string): BfIconName {
  const normalized = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR');

  if (normalized.includes('pix')) return 'qr-code';
  if (normalized.includes('dinheiro') || normalized.includes('cash')) return 'banknote';
  if (
    normalized.includes('cartao') ||
    normalized.includes('credito') ||
    normalized.includes('debito') ||
    normalized.includes('card')
  ) return 'card';
  if (normalized.includes('boleto') || normalized.includes('fatura')) return 'receipt';
  return 'payment-other';
}
