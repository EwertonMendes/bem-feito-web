/** Single source of truth for sale totals. Money is expressed in integer cents. */
export function calculateSaleTotalCents(subtotalCents: number, discountCents: number, shippingFeeCents = 0): number {
  for (const [label, amount] of [
    ['Subtotal', subtotalCents], ['Desconto', discountCents], ['Frete', shippingFeeCents],
  ] as const) {
    if (!Number.isSafeInteger(amount) || amount < 0 || amount > 1_000_000_000) {
      throw new Error(label + ' inválido.');
    }
  }
  if (discountCents > subtotalCents) throw new Error('O desconto não pode ultrapassar os produtos.');
  const total = subtotalCents - discountCents + shippingFeeCents;
  if (!Number.isSafeInteger(total) || total > 1_000_000_000) {
    throw new Error('Total da venda fora do limite permitido.');
  }
  return total;
}
