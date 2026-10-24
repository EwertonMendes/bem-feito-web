import { CollectionDefinition, FormatDefinition, FormatPrice, FragranceDefinition, Product } from '../models/catalog.model';
import { productIdentity } from './product-category';

export interface SoapCreationSelection {
  collectionId: string;
  fragranceIds: readonly string[];
  formatIds: readonly string[];
  customPricesCents: Readonly<Record<string, number>>;
}
export interface SoapCandidate {
  fragranceId: string;
  formatId: string;
  displayName: string;
  priceCents: number | null;
  priceSource: 'default' | 'custom' | 'missing';
  duplicate: boolean;
}
export function formatPriceForSelection(
  collectionId: string,
  formatId: string,
  priceRules: readonly FormatPrice[],
  customPricesCents: Readonly<Record<string, number>>,
): { cents: number | null; source: SoapCandidate['priceSource'] } {
  if (Object.prototype.hasOwnProperty.call(customPricesCents, formatId)) {
    return { cents: customPricesCents[formatId], source: 'custom' };
  }
  const price = priceRules.find(item => item.active && item.collectionId === collectionId && item.formatId === formatId);
  return price ? { cents: price.priceCents, source: 'default' } : { cents: null, source: 'missing' };
}

export function buildSoapCandidates(
  selection: SoapCreationSelection,
  collections: readonly CollectionDefinition[],
  fragrances: readonly FragranceDefinition[],
  formats: readonly FormatDefinition[],
  prices: readonly FormatPrice[],
  existingProducts: readonly Product[],
): SoapCandidate[] {
  const collection = collections.find(item => item.active && item.id === selection.collectionId);
  if (!collection) return [];
  const fragrancesById = new Map(fragrances.filter(item => item.active && item.collectionId === collection.id).map(item => [item.id, item]));
  const formatsById = new Map(formats.filter(item => item.active).map(item => [item.id, item]));
  const identities = new Set(existingProducts.map(productIdentity));
  const candidates: SoapCandidate[] = [];
  for (const fragranceId of new Set(selection.fragranceIds)) {
    const fragrance = fragrancesById.get(fragranceId);
    if (!fragrance) continue;
    for (const formatId of new Set(selection.formatIds)) {
      const format = formatsById.get(formatId);
      if (!format) continue;
      const identity = productIdentity({ categoryId: 'soap', collectionId: collection.id, fragranceId, formatId });
      const price = formatPriceForSelection(collection.id, formatId, prices, selection.customPricesCents);
      candidates.push({
        fragranceId, formatId,
        displayName: collection.name + ' · ' + fragrance.name + ' · ' + format.name,
        priceCents: price.cents, priceSource: price.source,
        duplicate: identities.has(identity),
      });
    }
  }
  return candidates;
}
