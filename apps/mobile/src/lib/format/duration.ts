/**
 * Duration formatting for elapsed play time.
 *
 * These render the *actual* recorded duration. Billable duration is a separate
 * number produced by the billing rules and must never be substituted here: the
 * screen showing a table that has been in play for 1h 07m has to say 1h 07m,
 * whatever the club decides to charge for it.
 */
export function formatDuration(totalSeconds: number): string {
  const safe = Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0;
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);

  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${String(minutes).padStart(2, '0')}m`;
}

/** `HH:MM:SS` for a live running clock. */
export function formatClock(totalSeconds: number): string {
  const safe = Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0;
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

export function elapsedSecondsSince(startedAtIso: string, now: number = Date.now()): number {
  const started = Date.parse(startedAtIso);
  if (Number.isNaN(started)) return 0;
  return Math.max(0, Math.floor((now - started) / 1000));
}

/**
 * How the configured time relates to the time actually played.
 *
 * `overrun` is informational: reaching or passing the booked time is a state to
 * surface, never a reason for the app to end a session on its own.
 */
export interface PlannedTimeProgress {
  readonly elapsedSeconds: number;
  readonly plannedSeconds: number | null;
  readonly remainingSeconds: number | null;
  readonly overrunSeconds: number;
  readonly hasReachedPlannedTime: boolean;
  /** 0..1, clamped. Null when the session has no booked duration. */
  readonly ratio: number | null;
}

export function plannedTimeProgress(
  elapsedSeconds: number,
  plannedDurationMinutes: number | null,
): PlannedTimeProgress {
  if (plannedDurationMinutes === null || plannedDurationMinutes <= 0) {
    return {
      elapsedSeconds,
      plannedSeconds: null,
      remainingSeconds: null,
      overrunSeconds: 0,
      hasReachedPlannedTime: false,
      ratio: null,
    };
  }

  const plannedSeconds = plannedDurationMinutes * 60;
  const remainingSeconds = plannedSeconds - elapsedSeconds;

  return {
    elapsedSeconds,
    plannedSeconds,
    remainingSeconds: Math.max(0, remainingSeconds),
    overrunSeconds: Math.max(0, -remainingSeconds),
    hasReachedPlannedTime: elapsedSeconds >= plannedSeconds,
    ratio: Math.min(1, Math.max(0, elapsedSeconds / plannedSeconds)),
  };
}
