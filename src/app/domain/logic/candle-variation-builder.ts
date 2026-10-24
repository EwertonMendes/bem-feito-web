import { CandleModel, CollectionDefinition, FragranceDefinition, Product } from '../models/catalog.model';
import { normalizedCatalogName, candleSourceValid } from './candle-model';
import { productCategoryId, productIdentity } from './product-category';

export interface CandleCandidate {
  fragranceId: string;
  aroma: string;
  displayName: string;
  duplicate: boolean;
}
export function buildCandleCandidates(
  model: CandleModel | undefined,
  fragranceIds: readonly string[],
  fragrances: readonly FragranceDefinition[],
  collections: readonly CollectionDefinition[],
  existing: readonly Product[],
): CandleCandidate[] {
  if (!model?.active || !candleSourceValid(model, collections)) return [];
  const byId = new Map(fragrances.filter(f => f.active && f.collectionId === model.sourceCollectionId)
    .map(fragrance => [fragrance.id, fragrance]));
  return [...new Set(fragranceIds)].flatMap(id => {
    const fragrance = byId.get(id);
    if (!fragrance) return [];
    const identity = productIdentity({
      categoryId: 'scented-candle', collectionId: '', fragranceId: '', formatId: '',
      modelName: model.name, variantName: fragrance.name,
    });
    const dup = existing.some(product => productCategoryId(product) === 'scented-candle' &&
      (product.volumeMl === model.volumeMl || normalizedCatalogName(product.modelName ?? '') === normalizedCatalogName(model.name)) &&
      (product.candleFragranceId === id || productIdentity(product) === identity ||
        normalizedCatalogName(product.variantName ?? '') === normalizedCatalogName(fragrance.name)));
    return [{fragranceId:id,aroma:fragrance.name,displayName:model.name+' · '+fragrance.name,duplicate:dup}];
  });
}
