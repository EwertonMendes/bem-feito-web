import { Product } from '../models/catalog.model';
export const PRODUCT_CATEGORIES = [
  { id: 'soap', label: 'Sabonetes' },
  { id: 'creative-kit', label: 'Kits Criativos' },
  { id: 'scented-candle', label: 'Velas Aromáticas' },
] as const;
export type ProductCategoryId = typeof PRODUCT_CATEGORIES[number]['id'];
export function productCategoryId(product: Pick<Product, 'categoryId'>): ProductCategoryId {
  return product.categoryId ?? 'soap';
}
export function productCategoryName(id: ProductCategoryId): string {
  return PRODUCT_CATEGORIES.find(category => category.id === id)?.label ?? id;
}
export function productIdentity(product: Pick<Product, 'categoryId' | 'collectionId' | 'fragranceId' | 'formatId' | 'modelName' | 'variantName'>): string {
  const norm = (v?: string) => (v ?? '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ');
  const cat = productCategoryId(product);
  return cat === 'soap'
    ? ['soap', norm(product.collectionId), norm(product.fragranceId), norm(product.formatId)].join(':')
    : [cat, norm(product.modelName), norm(product.variantName)].join(':');
}
