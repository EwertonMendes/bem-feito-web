import { InputItem, Product, StockStatus } from '../models/catalog.model';

export function productStockStatus(stock: number, minimumStock: number): StockStatus {
  if (stock < 0) return 'negative';
  return stock <= minimumStock ? 'low' : 'ok';
}

export function inputStockStatus(
  stock: number,
  minimumStock: number,
  minimumStockConfigured = true,
): StockStatus {
  if (stock < 0) return 'negative';
  if (!minimumStockConfigured) return 'untracked';
  return stock <= minimumStock ? 'low' : 'ok';
}

export function stockStatusForProduct(product: Pick<Product, 'stock' | 'minimumStock'>): StockStatus {
  return productStockStatus(product.stock, product.minimumStock);
}

export function stockStatusForInput(
  input: Pick<InputItem, 'stock' | 'minimumStock' | 'minimumStockConfigured'>,
): StockStatus {
  return inputStockStatus(input.stock, input.minimumStock, input.minimumStockConfigured !== false);
}
