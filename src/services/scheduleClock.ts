const MS_PER_DAY = 86_400_000;
const DEFAULT_SCHEDULE_TIMEZONE = 'UTC';

function normalizeTimeZone(timeZone?: string | null): string {
  const value = timeZone?.trim();
  if (!value) return DEFAULT_SCHEDULE_TIMEZONE;
  try {
    Intl.DateTimeFormat('en-US', { timeZone: value }).format(0);
    return value;
  } catch {
    return DEFAULT_SCHEDULE_TIMEZONE;
  }
}

function readCivilDate(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const bag: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== 'literal') bag[part.type] = part.value;
  }
  return `${bag.year}-${bag.month}-${bag.day}`;
}

/** Calendar date of an absolute instant in the schedule timezone. */
export function civilDateInTimeZone(instant: Date, timeZone?: string | null): string {
  return readCivilDate(instant, normalizeTimeZone(timeZone));
}

/**
 * Difference of two YYYY-MM-DD calendar dates.
 * The UTC encoding is only a day counter. It is not local-midnight milliseconds.
 */
export function calendarDaysBetween(fromYmd: string, toYmd: string): number {
  const [fromYear, fromMonth, fromDay] = fromYmd.split('-').map(Number);
  const [toYear, toMonth, toDay] = toYmd.split('-').map(Number);
  if (!fromYear || !fromMonth || !fromDay || !toYear || !toMonth || !toDay) return 0;
  const from = Date.UTC(fromYear, fromMonth - 1, fromDay);
  const to = Date.UTC(toYear, toMonth - 1, toDay);
  return Math.round((to - from) / MS_PER_DAY);
}

export function rotationDayForInstant(
  rotationStartDate: string,
  instant: Date,
  timeZone?: string | null,
  cycleDays = 36,
): number | null {
  const start = rotationStartDate.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return null;
  const today = civilDateInTimeZone(instant, timeZone);
  const elapsed = calendarDaysBetween(start, today);
  if (elapsed < 0) return 1;
  const cycle = cycleDays > 0 ? cycleDays : 36;
  return (elapsed % cycle) + 1;
}
