import { Sale, SaleLineSnapshot, OrderLineAllocation } from '../models/sales.model';

/** Legacy records have no verified per-order allocations and must not be silently guessed. */
export function orderProgress(sale: Sale): Array<{ line: SaleLineSnapshot; allocated: number | null; pending: number | null }> {
  return sale.items.filter(item => item.kind === 'product').map(line => {
    if (sale.fulfillmentStatus === 'delivered' || sale.stockApplied !== false) {
      return { line, allocated: line.quantity, pending: 0 };
    }
    if (!sale.orderAllocations) return { line, allocated: null, pending: null };
    const allocated = sale.orderAllocations.find(allocation => allocation.lineId === line.id)?.quantity ?? 0;
    return { line, allocated, pending: Math.max(0, line.quantity - allocated) };
  });
}

export function allocatedQuantity(allocations: readonly OrderLineAllocation[], line: SaleLineSnapshot): number {
  return allocations.find(allocation => allocation.lineId === line.id)?.quantity ?? 0;
}

export function validatedAllocation(line: SaleLineSnapshot, current: number, additional: number): number {
  if (line.kind !== 'product') throw new Error('Apenas sabonetes acabados são alocados por linha.');
  if (!Number.isSafeInteger(additional) || additional <= 0)
    throw new Error('Informe uma quantidade inteira maior que zero.');
  if (!Number.isSafeInteger(current) || current < 0 || current + additional > line.quantity)
    throw new Error('A quantidade excede o que falta nesta encomenda.');
  return current + additional;
}
