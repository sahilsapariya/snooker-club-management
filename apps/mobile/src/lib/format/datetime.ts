import { TZDate } from '@date-fns/tz';
import { format, formatDistanceToNowStrict, isValid } from 'date-fns';

/**
 * Date and time rendering, always in the CLUB's timezone.
 *
 * Timestamps are stored as `timestamptz`, i.e. UTC. A club in Kochi and its
 * owner travelling in London must see the same "yesterday's takings", so every
 * user-facing date is projected through the tenant's own timezone rather than
 * the device's.
 */
export interface TenantClock {
  readonly timezone: string;
  /** Trading-day rollover, `HH:MM:SS`. `04:00:00` means 01:30 belongs to the previous day. */
  readonly businessDayCutoff: string;
}

export const DEFAULT_CLOCK: TenantClock = {
  timezone: 'Asia/Kolkata',
  businessDayCutoff: '00:00:00',
};

function toTenantDate(iso: string, clock: TenantClock): TZDate | null {
  const parsed = new TZDate(iso, clock.timezone);
  return isValid(parsed) ? parsed : null;
}

export function formatTime(iso: string, clock: TenantClock = DEFAULT_CLOCK): string {
  const date = toTenantDate(iso, clock);
  return date ? format(date, 'h:mm a') : '--:--';
}

export function formatDate(iso: string, clock: TenantClock = DEFAULT_CLOCK): string {
  const date = toTenantDate(iso, clock);
  return date ? format(date, 'd MMM yyyy') : '--';
}

export function formatDateTime(iso: string, clock: TenantClock = DEFAULT_CLOCK): string {
  const date = toTenantDate(iso, clock);
  return date ? format(date, 'd MMM, h:mm a') : '--';
}

/** `2 minutes ago`, `3 hours ago`. Relative time is timezone-independent. */
export function formatRelative(iso: string): string {
  const parsed = new Date(iso);
  if (!isValid(parsed)) return '';
  return `${formatDistanceToNowStrict(parsed)} ago`;
}

/**
 * The business date an instant belongs to, mirroring `app.business_date` in the
 * database so the app and the server never disagree about which day a session
 * or expense lands on.
 */
export function businessDateOf(iso: string, clock: TenantClock = DEFAULT_CLOCK): string {
  const local = toTenantDate(iso, clock);
  if (!local) return '';

  const [hoursText = '0', minutesText = '0'] = clock.businessDayCutoff.split(':');
  const cutoffMinutes = Number.parseInt(hoursText, 10) * 60 + Number.parseInt(minutesText, 10);

  const shifted = new TZDate(local.getTime() - cutoffMinutes * 60_000, clock.timezone);
  return format(shifted, 'yyyy-MM-dd');
}
