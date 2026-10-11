export interface BusinessDateRange {
  startDate: string;
  endDate: string;
}

function formatLocalBusinessDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function todayBusinessDate(): string {
  return formatLocalBusinessDate(new Date());
}

export function daysAgoBusinessDate(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return formatLocalBusinessDate(date);
}

export function businessMonthDateRange(
  year: number,
  monthIndex: number,
  referenceDate = new Date(),
): BusinessDateRange {
  if (!Number.isInteger(year) || !Number.isInteger(monthIndex) || monthIndex < 0 || monthIndex > 11) {
    throw new RangeError('Invalid business month');
  }

  const startDate = formatLocalBusinessDate(new Date(year, monthIndex, 1));
  const isCurrentMonth =
    year === referenceDate.getFullYear() && monthIndex === referenceDate.getMonth();
  const end = isCurrentMonth
    ? referenceDate
    : new Date(year, monthIndex + 1, 0);

  return {
    startDate,
    endDate: formatLocalBusinessDate(end),
  };
}

export function currentMonthBusinessDateRange(referenceDate = new Date()): BusinessDateRange {
  return businessMonthDateRange(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate);
}


export type DashboardPeriodPreset = 'today' | 'last7' | 'last30' | 'month' | 'year';

/** Inclusive business-date ranges. Seven days means today plus the previous six days. */
export function dashboardPresetDateRange(
  preset: DashboardPeriodPreset,
  referenceDate = new Date(),
): BusinessDateRange {
  const endDate = formatLocalBusinessDate(referenceDate);
  if (preset === 'today') return { startDate: endDate, endDate };
  if (preset === 'month') return currentMonthBusinessDateRange(referenceDate);
  if (preset === 'year') {
    return { startDate: formatLocalBusinessDate(new Date(referenceDate.getFullYear(), 0, 1)), endDate };
  }
  const start = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate(), 12);
  start.setDate(start.getDate() - (preset === 'last7' ? 6 : 29));
  return { startDate: formatLocalBusinessDate(start), endDate };
}

/** Dates from native input[type=date] must be real calendar dates before querying Firestore. */
export function isValidBusinessDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1900 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const parsed = new Date(year, month - 1, day, 12);
  return parsed.getFullYear() === year && parsed.getMonth() + 1 === month && parsed.getDate() === day;
}

export function formatBusinessDate(value?: string): string {
  if (!value) return '—';
  const [year, month, day] = value.split('-');
  return year && month && day ? `${day}/${month}/${year}` : value;
}
