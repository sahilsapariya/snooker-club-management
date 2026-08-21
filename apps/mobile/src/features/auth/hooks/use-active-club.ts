import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { logger } from '@/lib/logger';
import { useActiveClubStore } from '@/stores/active-club.store';

import type { AccessibleClub } from '../model/types';

const log = logger.child('active-club');

/**
 * The single place a club switch happens.
 *
 * Switching is not just "set a variable". Every tenant-scoped query key starts
 * `['tenant', tenantId, …]`, so Club B's data lives in different cache entries
 * from Club A's and cannot be *shown* under the wrong club. But leaving Club A's
 * entries resident means switching back shows yesterday's numbers until a
 * refetch lands, and it keeps a departed club's data in memory. So the previous
 * club's cache is removed outright rather than merely invalidated.
 */
export function useSwitchClub() {
  const queryClient = useQueryClient();
  const current = useActiveClubStore((s) => s.tenantId);
  const select = useActiveClubStore((s) => s.select);

  return useCallback(
    async (tenantId: string) => {
      if (tenantId === current) return;

      if (current) {
        // Drop, don't invalidate: an invalidated entry is still served stale
        // while it refetches, which is exactly the "Club A data under Club B"
        // flash this is meant to prevent.
        queryClient.removeQueries({ queryKey: ['tenant', current] });
      }

      select(tenantId);
      log.info('Switched club', { from: current, to: tenantId });

      // The incoming club may have been visited earlier in this session, so its
      // entries can be stale too.
      await queryClient.invalidateQueries({ queryKey: ['tenant', tenantId] });
    },
    [current, select, queryClient],
  );
}

/**
 * Clears the active club and every club-scoped cache entry.
 *
 * Used when the stored club is no longer reachable, and when returning a
 * multi-club owner to the selector.
 */
export function useClearActiveClub() {
  const queryClient = useQueryClient();
  const clear = useActiveClubStore((s) => s.clear);

  return useCallback(() => {
    clear();
    queryClient.removeQueries({ queryKey: ['tenant'] });
  }, [clear, queryClient]);
}

/**
 * Picks the club to operate, given what the user can reach and what they last
 * chose.
 *
 * Pure, so every branch is testable without a store or a network:
 *
 *   no clubs                        → null, caller renders "no club"
 *   stored club still reachable     → that club
 *   stored club gone or suspended   → fall through, caller re-selects
 *   exactly one reachable club      → that club, no selector shown
 *   several reachable clubs         → null, caller shows the selector
 */
export function resolveActiveClub(
  clubs: readonly AccessibleClub[],
  storedTenantId: string | null,
): AccessibleClub | null {
  if (clubs.length === 0) return null;

  if (storedTenantId) {
    const stored = clubs.find((club) => club.tenant.id === storedTenantId);
    if (stored) return stored;
  }

  return clubs.length === 1 ? (clubs[0] ?? null) : null;
}
