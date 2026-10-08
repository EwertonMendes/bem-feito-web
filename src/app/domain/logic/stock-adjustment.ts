/**
 * A stock adjustment is always resolved against the latest committed balance.
 * The same pure calculation is used for previews and inside Firestore transactions.
 */
export type StockAdjustmentMode = 'set' | 'delta';

export interface StockAdjustmentPlan {
  currentStock: number;
  resultingStock: number;
  quantityDelta: number;
  clampedToZero: boolean;
}

const roundStock = (value: number): number => Math.round(value * 1_000) / 1_000;

export function planStockAdjustment(
  currentStock: number,
  mode: StockAdjustmentMode,
  quantity: number,
  clampNegative = true,
): StockAdjustmentPlan {
  if (!Number.isFinite(currentStock) || currentStock < 0) {
    throw new Error('Saldo atual inválido. Atualize o cadastro antes do ajuste.');
  }
  if (!Number.isFinite(quantity)) {
    throw new Error('Informe uma quantidade válida.');
  }
  if (mode === 'set' && quantity < 0) {
    throw new Error('O saldo total não pode ser negativo.');
  }
  const target = mode === 'set' ? quantity : currentStock + quantity;
  if (target < 0 && !clampNegative) {
    throw new Error('O ajuste não pode deixar o estoque negativo.');
  }
  const resultingStock = Math.max(0, roundStock(target));
  return {
    currentStock,
    resultingStock,
    quantityDelta: roundStock(resultingStock - currentStock),
    clampedToZero: target < 0,
  };
}
