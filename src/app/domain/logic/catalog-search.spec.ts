import { describe, expect, it } from 'vitest';
import { matchesCatalogSearch } from './catalog-search';

describe('shared catalog search for sales', () => {
  const fields=['Clássica','Lavanda','Mini Florzinhas','P-102'];
  it('finds products regardless of term order, punctuation and accents',()=>{
    expect(matchesCatalogSearch('mini lavanda',...fields)).toBe(true);
    expect(matchesCatalogSearch('lavanda MINI',...fields)).toBe(true);
    expect(matchesCatalogSearch('classica lavanda',...fields)).toBe(true);
    expect(matchesCatalogSearch('p 102',...fields)).toBe(true);
    expect(matchesCatalogSearch('Éros', '+ Aroma', 'Eros', 'Massageador')).toBe(true);
  });
  it('distinguishes size variants instead of matching the wrong product',()=>{
    expect(matchesCatalogSearch('patinha g tropical','Patinha G','Tropical')).toBe(true);
    expect(matchesCatalogSearch('patinha g tropical','Patinha M','Tropical')).toBe(false);
  });
  it('supports a clear search, exploratory letters and unknown products',()=>{
    expect(matchesCatalogSearch('',...fields)).toBe(true);
    expect(matchesCatalogSearch('l',...fields)).toBe(true);
    expect(matchesCatalogSearch('oceano',...fields)).toBe(false);
  });
});
