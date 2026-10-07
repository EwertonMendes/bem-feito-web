export function entityCode(prefix: string, sequence: number, size = 5): string {
  return `${prefix}${String(sequence).padStart(size, '0')}`;
}


export function catalogEntityCode(prefix: 'PROD' | 'INS', id: string, size = 8): string {
  const compact = id.replace(/[^a-z0-9]/gi, '').toUpperCase();
  const token = (compact || id.toUpperCase()).slice(0, size);
  return `${prefix}-${token}`;
}
