export interface BusinessDateCursor {
  businessDate: string;
  id: string;
}


export interface PageResult<T, C = BusinessDateCursor> {
  items: T[];
  nextCursor: C | null;
  hasMore: boolean;
}

export function compareBusinessDateDesc<T extends { businessDate: string; id: string }>(a: T, b: T): number {
  return b.businessDate.localeCompare(a.businessDate) || b.id.localeCompare(a.id);
}
