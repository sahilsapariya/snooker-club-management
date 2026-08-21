import type { TenantClock } from '@/lib/format';

import { daysBetween, percentChange, previousRange, resolveRange, shiftDays } from './date-range';

/**
 * Report ranges are expressed in the club's trading calendar. Getting that
 * wrong silently attributes a late-night session to the wrong day and makes
 * every report subtly disagree with the till.
 */

/** Trades until 4am, so 01:30 local still belongs to the previous day. */
const LATE_CLUB: TenantClock = { timezone: 'Asia/Kolkata', businessDayCutoff: '04:00:00' };
/** Closes at midnight. */
const NORMAL_CLUB: TenantClock = { timezone: 'Asia/Kolkata', businessDayCutoff: '00:00:00' };

describe('shiftDays', () => {
  it('moves forwards and backwards', () => {
    expect(shiftDays('2026-08-21', 1)).toBe('2026-08-22');
    expect(shiftDays('2026-08-21', -1)).toBe('2026-08-20');
    expect(shiftDays('2026-08-21', 0)).toBe('2026-08-21');
  });

  it('crosses month and year boundaries', () => {
    expect(shiftDays('2026-08-31', 1)).toBe('2026-09-01');
    expect(shiftDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(shiftDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('handles a leap day', () => {
    expect(shiftDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(shiftDays('2028-03-01', -1)).toBe('2028-02-29');
  });

  it('leaves malformed input alone rather than inventing a date', () => {
    expect(shiftDays('not-a-date', 1)).toBe('not-a-date');
  });
});

describe('resolveRange', () => {
  // 2026-08-20 21:00 UTC = 2026-08-21 02:30 IST.
  const lateNight = new Date('2026-08-20T21:00:00.000Z');

  it('keeps a late-night club on the day that is still running', () => {
    // 02:30 with a 4am cutoff is still the 20th's trading day.
    const range = resolveRange('today', LATE_CLUB, lateNight);
    expect(range.from).toBe('2026-08-20');
    expect(range.to).toBe('2026-08-20');
  });

  it('rolls a midnight-closing club over at midnight', () => {
    const range = resolveRange('today', NORMAL_CLUB, lateNight);
    expect(range.from).toBe('2026-08-21');
    expect(range.to).toBe('2026-08-21');
  });

  it('makes a 7 day range inclusive of both ends', () => {
    const range = resolveRange('week', LATE_CLUB, lateNight);
    expect(range.to).toBe('2026-08-20');
    expect(range.from).toBe('2026-08-14'); // 7 days counting today
    expect(daysBetween(range.from, range.to)).toBe(7);
  });

  it('sizes the longer presets correctly', () => {
    for (const [preset, days] of [
      ['today', 1],
      ['week', 7],
      ['month', 30],
      ['quarter', 90],
    ] as const) {
      const range = resolveRange(preset, LATE_CLUB, lateNight);
      expect(daysBetween(range.from, range.to)).toBe(days);
      expect(range.days).toBe(days);
    }
  });
});

describe('previousRange', () => {
  it('sits immediately before the current range without overlapping it', () => {
    const current = resolveRange('week', NORMAL_CLUB, new Date('2026-08-21T12:00:00.000Z'));
    const previous = previousRange(current);

    expect(previous.to).toBe(shiftDays(current.from, -1));
    expect(daysBetween(previous.from, previous.to)).toBe(current.days);
    // No day belongs to both, or growth would be double-counted.
    expect(previous.to < current.from).toBe(true);
  });
});

describe('percentChange', () => {
  it('computes growth and decline', () => {
    expect(percentChange(150, 100)).toBe(50);
    expect(percentChange(50, 100)).toBe(-50);
    expect(percentChange(100, 100)).toBe(0);
  });

  it('returns null rather than Infinity for a club with no history', () => {
    // A new club's first week has nothing to compare against; "up ∞%" is not a
    // useful thing to render.
    expect(percentChange(5000, 0)).toBeNull();
  });

  it('treats zero-to-zero as flat, not unknown', () => {
    expect(percentChange(0, 0)).toBe(0);
  });
});
