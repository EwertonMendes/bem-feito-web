export interface BusinessDateCursor {
  businessDate: string;
  id: string;
}

export interface BalanceCursor {
  balanceCents: number;
  id: string;
}

export interface PageResult<T, C = BusinessDateCursor> {
  items: T[];
  nextCursor: C | null;
  hasMore: boolean;
}
