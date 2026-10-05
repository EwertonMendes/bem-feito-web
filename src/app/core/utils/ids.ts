export function entityCode(prefix: string, sequence: number, size = 5): string {
  return `${prefix}${String(sequence).padStart(size, '0')}`;
}
