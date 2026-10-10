import { AcquisitionCharge, PurchaseItem } from '../models/finance.model';

/** Allocate landed costs once with integer cents; finance charges stay outside inventory. */
export function landedPurchaseCosts(items: readonly PurchaseItem[], charges: readonly AcquisitionCharge[]): number[] {
  if (!items.length) throw new Error('Informe os itens da compra.');
  if (items.some(item => !Number.isSafeInteger(item.amountCents) || item.amountCents <= 0)) throw new Error('Valor de item inválido.');
  if (charges.some(charge => !Number.isSafeInteger(charge.amountCents) || charge.amountCents < 0)) throw new Error('Custo de aquisição inválido.');
  const base = items.reduce((total, item) => total + item.amountCents, 0);
  let extra = charges.filter(charge => charge.capitalized).reduce((total, charge) => total + charge.amountCents, 0);
  return items.map((item, index) => {
    if (index === items.length - 1) return item.amountCents + extra;
    const allocated = Math.floor(charges.filter(charge => charge.capitalized).reduce((sum, c) => sum + c.amountCents, 0) * item.amountCents / base);
    extra -= allocated;
    return item.amountCents + allocated;
  });
}
