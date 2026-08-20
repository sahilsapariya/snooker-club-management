import { elapsedSecondsSince, formatClock, formatDuration, plannedTimeProgress } from './duration';

describe('formatDuration', () => {
  it('renders minutes below the hour and hours above it', () => {
    expect(formatDuration(0)).toBe('0m');
    expect(formatDuration(59)).toBe('0m');
    expect(formatDuration(42 * 60)).toBe('42m');
    expect(formatDuration(67 * 60)).toBe('1h 07m');
    expect(formatDuration(3 * 3600 + 5 * 60)).toBe('3h 05m');
  });

  it('is defensive about bad input', () => {
    expect(formatDuration(-100)).toBe('0m');
    expect(formatDuration(Number.NaN)).toBe('0m');
  });
});

describe('formatClock', () => {
  it('renders a zero-padded running clock', () => {
    expect(formatClock(0)).toBe('00:00:00');
    expect(formatClock(4020)).toBe('01:07:00');
    expect(formatClock(59)).toBe('00:00:59');
  });
});

describe('elapsedSecondsSince', () => {
  it('measures forward from the recorded start', () => {
    const started = '2026-08-20T10:00:00.000Z';
    const now = Date.parse('2026-08-20T11:07:00.000Z');
    expect(elapsedSecondsSince(started, now)).toBe(4020);
  });

  it('never goes negative for a clock skew', () => {
    const started = '2026-08-20T10:00:00.000Z';
    expect(elapsedSecondsSince(started, Date.parse('2026-08-20T09:59:00.000Z'))).toBe(0);
  });
});

describe('plannedTimeProgress', () => {
  /**
   * The rule this encodes: passing the booked time is a *state*, not the end of
   * the session. A 60 minute booking played for 67 minutes reports 7 minutes of
   * overrun and keeps the elapsed time intact - it does not clamp, and nothing
   * here decides to stop.
   */
  it('reports overrun without truncating the elapsed time', () => {
    const progress = plannedTimeProgress(67 * 60, 60);

    expect(progress.elapsedSeconds).toBe(4020);
    expect(progress.plannedSeconds).toBe(3600);
    expect(progress.overrunSeconds).toBe(7 * 60);
    expect(progress.remainingSeconds).toBe(0);
    expect(progress.hasReachedPlannedTime).toBe(true);
    // The bar fills, but the underlying elapsed value is untouched.
    expect(progress.ratio).toBe(1);
  });

  it('reports remaining time before the booked duration is reached', () => {
    const progress = plannedTimeProgress(20 * 60, 60);
    expect(progress.remainingSeconds).toBe(40 * 60);
    expect(progress.overrunSeconds).toBe(0);
    expect(progress.hasReachedPlannedTime).toBe(false);
    expect(progress.ratio).toBeCloseTo(1 / 3, 5);
  });

  it('treats the exact boundary as reached', () => {
    expect(plannedTimeProgress(3600, 60).hasReachedPlannedTime).toBe(true);
  });

  it('handles a session with no booked duration', () => {
    const progress = plannedTimeProgress(90 * 60, null);
    expect(progress.plannedSeconds).toBeNull();
    expect(progress.remainingSeconds).toBeNull();
    expect(progress.hasReachedPlannedTime).toBe(false);
    expect(progress.ratio).toBeNull();
    expect(progress.elapsedSeconds).toBe(5400);
  });
});
