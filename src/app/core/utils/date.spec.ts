import { describe, expect, it } from 'vitest';
import { businessMonthDateRange, currentMonthBusinessDateRange, dashboardPresetDateRange, isValidBusinessDate } from './date';

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


describe('dashboard quick periods', () => {
  const reference = new Date(2026, 9, 11, 12);

  it('uses the inclusive local day for Today', () => {
    expect(dashboardPresetDateRange('today', reference)).toEqual({
      startDate: '2026-10-11', endDate: '2026-10-11',
    });
  });

  it('includes today in the last 7 and last 30 days', () => {
    expect(dashboardPresetDateRange('last7', reference)).toEqual({
      startDate: '2026-10-05', endDate: '2026-10-11',
    });
    expect(dashboardPresetDateRange('last30', reference)).toEqual({
      startDate: '2026-09-12', endDate: '2026-10-11',
    });
  });

  it('supports month-to-date and year-to-date', () => {
    expect(dashboardPresetDateRange('month', reference)).toEqual({
      startDate: '2026-10-01', endDate: '2026-10-11',
    });
    expect(dashboardPresetDateRange('year', reference)).toEqual({
      startDate: '2026-01-01', endDate: '2026-10-11',
    });
  });

  it('crosses month/year boundaries and leap days safely', () => {
    expect(dashboardPresetDateRange('last7', new Date(2026, 0, 3, 12))).toEqual({
      startDate: '2025-12-28', endDate: '2026-01-03',
    });
    expect(dashboardPresetDateRange('last30', new Date(2024, 2, 1, 12))).toEqual({
      startDate: '2024-02-01', endDate: '2024-03-01',
    });
  });

  it('rejects invalid custom dates', () => {
    expect(isValidBusinessDate('2026-10-11')).toBe(true);
    expect(isValidBusinessDate('2024-02-29')).toBe(true);
    expect(isValidBusinessDate('2026-02-29')).toBe(false);
    expect(isValidBusinessDate('2026-13-01')).toBe(false);
    expect(isValidBusinessDate('11/10/2026')).toBe(false);
    expect(isValidBusinessDate('')).toBe(false);
  });
});
