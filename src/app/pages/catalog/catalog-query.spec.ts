import { describe, expect, it } from 'vitest';
import { catalogProfit, matchesCatalogAvailability, matchesCatalogSearch, normalizeCatalogText } from './catalog-query';

describe('catalog search', () => {
  const item = ['Clássica', 'Broto de Bambu', 'Patinha G', 'PROD-020'];
  it('matches independent terms in any order, ignoring accents and case', () => {
    expect(matchesCatalogSearch('Broto de bambu patinha G', ...item)).toBe(true);
    expect(matchesCatalogSearch('patinha g BROTO', ...item)).toBe(true);
    expect(matchesCatalogSearch('Classica patinha', ...item)).toBe(true);
    expect(matchesCatalogSearch('Massageador Éros', 'Linha + Aroma', 'Éros', 'Massageador')).toBe(true);
    expect(matchesCatalogSearch('Classica mini cubinhos', 'Clássica', 'Mini Cubinhos')).toBe(true);
    expect(normalizeCatalogText('  ÉROS + Aroma  ')).toBe('eros aroma');
  });
  it('allows a single letter to search inside names, codes and accents', () => {
    expect(matchesCatalogSearch('a', 'Clássica', 'Lavanda', 'Barra Arredondada')).toBe(true);
    expect(matchesCatalogSearch('b', 'Clássica', 'Broto de Bambu', 'Massageador')).toBe(true);
    expect(matchesCatalogSearch('e', '+ Aroma', 'Éros', 'Patinha G')).toBe(true);
    expect(matchesCatalogSearch('x', 'Clássica', 'Lavanda')).toBe(false);
    expect(matchesCatalogSearch('g', 'Patinha G')).toBe(true);
    expect(matchesCatalogSearch('g', 'Patinha M')).toBe(false);
    expect(matchesCatalogSearch('patinha g', 'Patinha M', 'Grande embalagem')).toBe(false);
  });
  it('does not confuse M and G variants or unrelated terms', () => {
    expect(matchesCatalogSearch('Patinha M', ...item)).toBe(false);
    expect(matchesCatalogSearch('Lavanda', ...item)).toBe(false);
    expect(matchesCatalogSearch('patinha g', 'Patinha M', 'Grande embalagem')).toBe(false);
  });
  it('filters availability while treating inactive separately', () => {
    expect(matchesCatalogAvailability({active:true,stock:0,minimumStock:5},'low')).toBe(true);
    expect(matchesCatalogAvailability({active:true,stock:0},'available')).toBe(false);
    expect(matchesCatalogAvailability({active:false,stock:4},'inactive')).toBe(true);
    expect(matchesCatalogAvailability({active:false,stock:4},'available')).toBe(false);
  });
});
describe('estimated catalog profitability', () => {
  it('computes gross margin on sales price', () => {
    expect(catalogProfit(1000, 400, false)).toEqual({profitCents:600,marginPercent:60});
    expect(catalogProfit(0, 400, false)).toEqual({profitCents:-400,marginPercent:null});
  });
  it('does not present a fake margin when input costs are pending', () => {
    expect(catalogProfit(1000, 400, true)).toEqual({profitCents:null,marginPercent:null});
  });
});
