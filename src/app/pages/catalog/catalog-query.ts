export { normalizeCatalogText, matchesCatalogSearch } from '../../domain/logic/catalog-search';

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
