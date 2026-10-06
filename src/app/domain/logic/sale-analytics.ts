import { SaleLineSnapshot } from '../models/sales.model';

export const SALE_ANALYTICS_VERSION = 1 as const;

export interface SaleAnalytics {
  analyticsVersion: typeof SALE_ANALYTICS_VERSION;
  cogsCents: number;
  itemsSold: number;
  missingCostItems: number;
}

export function summarizeSaleItems(items: readonly SaleLineSnapshot[]): SaleAnalytics {
  let cogsCents = 0;
  let itemsSold = 0;
  let missingCostItems = 0;

  for (const item of items) {
    cogsCents += item.totalCostCents;

    if (item.kind === 'product') {
      itemsSold += item.quantity;
      if (item.totalCostCents <= 0) missingCostItems += 1;
      continue;
    }

    if (item.kind === 'kit') {
      const components = item.components ?? [];
      itemsSold += components.reduce((sum, component) => sum + component.quantity, 0);
      missingCostItems += components.filter((component) => component.unitCostCents <= 0).length;
    }
  }

  return {
    analyticsVersion: SALE_ANALYTICS_VERSION,
    cogsCents,
    itemsSold,
    missingCostItems,
  };
}
