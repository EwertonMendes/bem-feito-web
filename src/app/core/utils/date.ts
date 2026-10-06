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

export function formatBusinessDate(value?: string): string {
  if (!value) return '—';
  const [year, month, day] = value.split('-');
  return year && month && day ? `${day}/${month}/${year}` : value;
}
