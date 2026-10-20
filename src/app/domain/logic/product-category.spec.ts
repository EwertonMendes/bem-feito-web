import { describe, expect, it } from 'vitest';
import { productCategoryId, productCategoryName, productIdentity } from './product-category';
const soap = { collectionId:'c', fragranceId:'f', formatId:'bar' };
const candle = { collectionId:'', fragranceId:'', formatId:'', categoryId:'scented-candle' as const, modelName:'Vela 40 ml', variantName:'Éros' };
const kit = { collectionId:'', fragranceId:'', formatId:'', categoryId:'creative-kit' as const, modelName:'Kit Florzinhas' };
describe('product categories', () => {
  it('classifies legacy documents as soap', () => {
    expect(productCategoryId({})).toBe('soap');
    expect(productCategoryName('creative-kit')).toBe('Kits Criativos');
    expect(productIdentity(soap)).toBe(productIdentity({...soap,categoryId:'soap'}));
  });
  it('distinguishes candle aromas, volumes and kits', () => {
    expect(productIdentity(candle)).not.toBe(productIdentity({...candle,variantName:'Ocean'}));
    expect(productIdentity(candle)).not.toBe(productIdentity({...candle,modelName:'Vela 100 ml'}));
    expect(productIdentity(candle)).not.toBe(productIdentity(kit));
    expect(productIdentity(candle)).toBe(productIdentity({...candle,variantName:'EROS'}));
  });
});
