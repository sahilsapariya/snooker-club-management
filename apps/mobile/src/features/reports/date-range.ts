import { businessDateOf, type TenantClock } from '@/lib/format';

export type RangePreset = 'today' | 'week' | 'month' | 'quarter';

export interface DateRange {
  /** Inclusive, `yyyy-MM-dd`, in the club's own trading calendar. */
  readonly from: string;
  readonly to: string;
  readonly label: string;
  readonly days: number;
}

/**
 * Turns a preset into a business-date range.
 *
 * Ranges are expressed in the club's TRADING calendar, not the device's
 * calendar. A club that closes at 4am is still on yesterday's books at 2am, so
 * "today" for a receptionist at 2am means the day that is still running - not
 * the one the phone's clock just rolled over to.
 *
 * Pure, so the boundaries are testable rather than dependent on when the suite
 * happens to run.
 */
export function resolveRange(
  preset: RangePreset,
  clock: TenantClock,
  now: Date = new Date(),
): DateRange {
  const today = businessDateOf(now.toISOString(), clock);

  const spans: Record<RangePreset, { days: number; label: string }> = {
    today: { days: 1, label: 'Today' },
    week: { days: 7, label: 'Last 7 days' },
    month: { days: 30, label: 'Last 30 days' },
    quarter: { days: 90, label: 'Last 90 days' },
  };

  const { days, label } = spans[preset];
  return { from: shiftDays(today, -(days - 1)), to: today, label, days };
}

/**
 * Adds days to a `yyyy-MM-dd` string.
 *
 * Uses UTC arithmetic deliberately: the input is already a calendar date in the
 * club's frame, so re-interpreting it in the device's local zone would shift it
 * by a day for anyone west of UTC.
 */
export function shiftDays(isoDate: string, delta: number): string {
  const [year, month, day] = isoDate.split('-').map((part) => Number.parseInt(part, 10));
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    Number.isNaN(year) ||
    Number.isNaN(month) ||
    Number.isNaN(day)
  ) {
    return isoDate;
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

/** Inclusive day count between two business dates. */
export function daysBetween(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.floor((end - start) / 86_400_000) + 1;
}

/**
 * The equivalent range immediately before this one, for period-on-period
 * comparison. A 7-day range compares against the 7 days before it.
 */
export function previousRange(range: DateRange): DateRange {
  return {
    from: shiftDays(range.from, -range.days),
    to: shiftDays(range.from, -1),
    label: `Previous ${range.days} days`,
    days: range.days,
  };
}

/** Percentage change, guarding the divide-by-zero a new club always hits. */
export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / previous) * 100;
}
