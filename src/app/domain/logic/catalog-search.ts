/** Accent-insensitive, order-independent catalog search shared by every sales and catalog surface.
 * Single-letter variant tokens distinguish Patinha G from Patinha M.
 */
export function normalizeCatalogText(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}

export function matchesCatalogSearch(query: string, ...fields: Array<string | undefined | null>): boolean {
  const terms = normalizeCatalogText(query).split(' ').filter(Boolean);
  if (!terms.length) return true;
  const searchable = normalizeCatalogText(fields.filter(Boolean).join(' ')).split(' ').filter(Boolean);
  return terms.every(term => searchable.some(word => term.length === 1
    ? (terms.length === 1 ? word.includes(term) : word === term)
    : word.startsWith(term)));
}
