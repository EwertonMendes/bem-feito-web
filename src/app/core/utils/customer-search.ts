export function normalizeCustomerSearch(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .toLocaleLowerCase('pt-BR').replace(/\s+/g,' ').trim();
}

/** Prefixes are materialized on write; they never require scanning sales on the client. */
export function customerSearchPrefixes(name: string): string[] {
  const normalized = normalizeCustomerSearch(name);
  const words = [normalized, ...normalized.split(' ')].filter(Boolean);
  const prefixes = new Set<string>();
  for (const word of words) {
    for (let length = 2; length <= Math.min(word.length, 60); length += 1) {
      prefixes.add(word.slice(0, length));
    }
  }
  return [...prefixes].slice(0, 280);
}
