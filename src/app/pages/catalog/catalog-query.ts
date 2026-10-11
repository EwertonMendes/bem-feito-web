/** Token-based search for catalog entities. Accent-insensitive, order-independent.
 * Single-character tokens are matched exactly to distinguish Patinha G from Patinha M.
 */
export function normalizeCatalogText(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}

export function matchesCatalogSearch(query: string, ...fields: Array<string | undefined | null>): boolean {
  const terms = normalizeCatalogText(query).split(' ').filter(Boolean);
  if (!terms.length) return true;
  const searchable = normalizeCatalogText(fields.filter(Boolean).join(' ')).split(' ').filter(Boolean);
  return terms.every(term => searchable.some(word => term.length === 1 ? word === term : word.startsWith(term)));
}

export type CatalogAvailability = 'all' | 'available' | 'unavailable' | 'low' | 'inactive';

export function matchesCatalogAvailability(
  item: { active: boolean; stock: number; minimumStock?: number },
  state: CatalogAvailability,
): boolean {
  if (state === 'all') return true;
  if (state === 'inactive') return !item.active;
  if (!item.active) return false;
  if (state === 'available') return item.stock > 0;
  if (state === 'unavailable') return item.stock <= 0;
  return item.stock <= (item.minimumStock ?? 0);
}

export function catalogProfit(
  priceCents: number, costCents: number | null, incomplete: boolean,
): { profitCents: number | null; marginPercent: number | null } {
  if (incomplete || costCents === null || !Number.isFinite(costCents)) {
    return { profitCents: null, marginPercent: null };
  }
  const profitCents = priceCents - costCents;
  return {
    profitCents,
    marginPercent: priceCents > 0 ? profitCents / priceCents * 100 : null,
  };
}
