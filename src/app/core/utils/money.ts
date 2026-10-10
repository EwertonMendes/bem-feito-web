export function toCents(value: number): number {
  return Math.round((Number.isFinite(value) ? value : 0) * 100);
}

export function fromCents(value: number): number {
  return (Number.isFinite(value) ? value : 0) / 100;
}

export function formatCurrency(valueCents: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(fromCents(valueCents));
}

export function clampCents(value: number): number {
  return Math.max(0, Math.round(Number.isFinite(value) ? value : 0));
}
