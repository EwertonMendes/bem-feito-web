export function normalizeCustomerSearch(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .toLocaleLowerCase('pt-BR').replace(/\s+/g,' ').trim();
}
