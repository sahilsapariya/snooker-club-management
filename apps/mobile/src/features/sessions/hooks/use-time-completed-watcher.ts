import { useEffect, useRef } from 'react';

import { presentLocalNotification } from '@/features/notifications';
import { logger } from '@/lib/logger';

import type { SessionWithContext } from '../api/sessions.api';
import { useMarkTimeCompleted } from './use-sessions';

const log = logger.child('sessions:watcher');

/** How often to check whether a booked time has elapsed. */
const TICK_MS = 30_000;

/**
 * Watches open sessions and flips them to TIME_COMPLETED when their booked
 * time elapses.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * IT DOES NOT END SESSIONS. THAT IS THE WHOLE POINT.
 * ─────────────────────────────────────────────────────────────────────────
 * Reaching the booked time is an *event*, not a termination. The clock keeps
 * running, the customer keeps playing, and only a receptionist closes the
 * session. All this does is change a status so the table turns amber and
 * somebody gets told.
 *
 * This is a convenience for whoever has the app open, not a guarantee. A
 * server-side job is the durable version; see docs/notifications.md. Because it
 * is best-effort, every transition is idempotent - the update is conditional on
 * the row still being ACTIVE, so two devices racing produces one transition.
 */
export function useTimeCompletedWatcher(
  tenantId: string | null,
  sessions: readonly SessionWithContext[] | undefined,
  options: { readonly notify: boolean; readonly clubName?: string } = { notify: true },
): void {
  const markTimeCompleted = useMarkTimeCompleted(tenantId);
  // Sessions already announced in this app run, so a re-render or a refetch
  // does not fire the notification again.
  const announced = useRef<Set<string>>(new Set());

  const mutate = markTimeCompleted.mutate;
  const shouldNotify = options.notify;
  const clubName = options.clubName ?? 'Your club';

  useEffect(() => {
    if (!tenantId || !sessions || sessions.length === 0) return;

    function check(): void {
      const now = Date.now();

      for (const session of sessions ?? []) {
        if (session.status !== 'ACTIVE') continue;
        if (session.planned_duration_minutes === null) continue;

        const startedAt = Date.parse(session.started_at);
        if (Number.isNaN(startedAt)) continue;

        const dueAt = startedAt + session.planned_duration_minutes * 60_000;
        if (now < dueAt) continue;
        if (announced.current.has(session.id)) continue;

        announced.current.add(session.id);
        log.info('Booked time elapsed', {
          sessionId: session.id,
          table: session.club_table?.name,
        });

        mutate(session.id);

        if (shouldNotify) {
          void presentLocalNotification({
            type: 'SESSION_TIME_COMPLETED',
            clubName,
            tenantId: session.tenant_id,
            tableName: session.club_table?.name ?? 'A table',
            sessionId: session.id,
            bookedMinutes: session.planned_duration_minutes,
          });
        }
      }
    }

    check();
    const interval = setInterval(check, TICK_MS);
    return () => clearInterval(interval);
  }, [tenantId, sessions, mutate, shouldNotify, clubName]);
}
