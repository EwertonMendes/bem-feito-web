export interface BusinessDateCursor {
  businessDate: string;
  id: string;
}

export interface PageResult<T> {
  items: T[];
  nextCursor: BusinessDateCursor | null;
  hasMore: boolean;
}
