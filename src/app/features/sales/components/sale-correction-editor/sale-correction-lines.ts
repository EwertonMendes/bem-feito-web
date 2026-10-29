import type { AdvancedSaleLineDraft } from '../../../../domain/logic/advanced-sale-edit';
import type { SaleLineSnapshot } from '../../../../domain/models/sales.model';

/**
 * Keep existing lines in their original draft order while showing newly added
 * lines first, most recent first. This changes only the UI order; persistence,
 * historical costs and stock calculations keep the original draft intact.
 */
export function orderSaleCorrectionLines(
  lines: readonly AdvancedSaleLineDraft[],
  originalLines: readonly Pick<SaleLineSnapshot,'id'>[],
): AdvancedSaleLineDraft[] {
  const originalIds = new Set(originalLines.map(line=>line.id));
  const newLines: AdvancedSaleLineDraft[]=[];
  const existingLines: AdvancedSaleLineDraft[]=[];
  for(const line of lines){
    if(originalIds.has(line.id))existingLines.push(line);
    else newLines.push(line);
  }
  return [...newLines.reverse(),...existingLines];
}
