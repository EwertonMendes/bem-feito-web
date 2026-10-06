import { describe, expect, it } from 'vitest';
import { businessMonthDateRange, currentMonthBusinessDateRange } from './date';

describe('business date ranges', () => {
  it('uses month-to-date for the current month', () => {
    const reference = new Date(2026, 9, 6, 12, 0, 0);

    expect(currentMonthBusinessDateRange(reference)).toEqual({
      startDate: '2026-10-01',
      endDate: '2026-10-06',
    });
  });

  it('uses the complete calendar month for a previous month', () => {
    const reference = new Date(2026, 9, 6, 12, 0, 0);

    expect(businessMonthDateRange(2026, 8, reference)).toEqual({
      startDate: '2026-09-01',
      endDate: '2026-09-30',
    });
  });

  it('respects the real last day of each month', () => {
    const reference = new Date(2026, 9, 6, 12, 0, 0);

    expect(businessMonthDateRange(2024, 1, reference)).toEqual({
      startDate: '2024-02-01',
      endDate: '2024-02-29',
    });
  });
});
