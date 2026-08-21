import { useQuery } from '@tanstack/react-query';
import { useCallback } from 'react';

import { queryKeys } from '@/lib/query';

import { fetchTenantActivity, recordActivity, type ActivityInput } from '../api/activity.api';

/**
 * The limit is part of the key on purpose. Two screens asking for 20 and 100
 * entries are asking different questions, and sharing one cache entry would
 * serve whichever asked first - most likely showing a truncated history as if
 * it were the whole thing.
 */
export function useTenantActivity(tenantId: string | null, limit = 50) {
  return useQuery({
    queryKey: queryKeys.activity.recent(tenantId ?? 'none', limit),
    queryFn: () => fetchTenantActivity(tenantId as string, limit),
    enabled: tenantId !== null,
    staleTime: 30_000,
  });
}

/**
 * Records activity against the club currently being operated.
 *
 * Binding the club here, rather than at each call site, is the point: a caller
 * cannot forget to say which club an action belonged to, and cannot name the
 * wrong one after a switch.
 */
export function useRecordActivity(tenantId: string | null) {
  return useCallback(
    (input: Omit<ActivityInput, 'tenantId'>) => {
      if (!tenantId) return Promise.resolve();
      return recordActivity({ ...input, tenantId });
    },
    [tenantId],
  );
}
