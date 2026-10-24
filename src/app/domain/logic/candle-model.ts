import { CandleModel, CollectionDefinition } from '../models/catalog.model';

export const DEFAULT_CANDLE_MODEL: CandleModel = {
  id: 'candle-40ml',
  name: 'Vela 40 ml',
  volumeMl: 40,
  priceCents: 2000,
  sourceCollectionId: '',
  active: true,
};

/** Accent-independent only for finding the conventional Mais Aroma source on existing installations. */
export function normalizedCatalogName(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g,' ').toLocaleLowerCase('pt-BR');
}
export function candleSourceValid(model: CandleModel, collections: readonly CollectionDefinition[]): boolean {
  return collections.some(collection => collection.active && collection.id === model.sourceCollectionId);
}
