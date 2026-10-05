import { describe, expect, it } from 'vitest';
import { clampCents, fromCents, toCents } from './money';

describe('money', () => {
  it('converte decimal para centavos', () => {
    expect(toCents(14.9)).toBe(1490);
    expect(toCents(0.1 + 0.2)).toBe(30);
  });

  it('converte centavos para decimal', () => {
    expect(fromCents(1490)).toBe(14.9);
  });

  it('limita negativos quando necessário', () => {
    expect(clampCents(-20)).toBe(0);
  });
});
