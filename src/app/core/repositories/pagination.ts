export interface BusinessDateCursor {
  businessDate: string;
  id: string;
}


export interface PageResult<T, C = BusinessDateCursor> {
  items: T[];
  nextCursor: C | null;
  hasMore: boolean;
}
