import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { queryKeys } from '@/lib/query';

import {
  addSessionItem,
  cancelSession,
  closeSession,
  fetchOpenSessions,
  fetchRecentSessions,
  fetchSession,
  markTimeCompleted,
  removeSessionItem,
  startSession,
  updateSessionFrames,
  updateSessionItemQuantity,
  type AddSessionItemInput,
  type CloseSessionInput,
  type StartSessionInput,
} from '../api/sessions.api';

/**
 * Anything that changes a session also changes what the Tables screen shows,
 * because occupancy is derived from open sessions rather than stored on the
 * table. Invalidating both together is what keeps the two screens honest.
 */
async function invalidateSessionViews(
  queryClient: QueryClient,
  tenantId: string,
  sessionId?: string,
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.sessions.open(tenantId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.tables.overview(tenantId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.sessions.recent(tenantId) }),
    ...(sessionId
      ? [queryClient.invalidateQueries({ queryKey: queryKeys.sessions.byId(tenantId, sessionId) })]
      : []),
  ]);
}

export function useOpenSessions(tenantId: string | null) {
  const query = useQuery({
    queryKey: queryKeys.sessions.open(tenantId ?? 'none'),
    queryFn: () => fetchOpenSessions(tenantId as string),
    enabled: tenantId !== null,
    staleTime: 15_000,
    refetchInterval: 60_000,
  });

  return {
    data: query.data,
    isPending: query.isPending,
    isError: query.isError,
    error: query.error,
    isRefetching: query.isRefetching,
    refetch: query.refetch,
  };
}

export function useRecentSessions(tenantId: string | null) {
  return useQuery({
    queryKey: queryKeys.sessions.recent(tenantId ?? 'none'),
    queryFn: () => fetchRecentSessions(tenantId as string),
    enabled: tenantId !== null,
    staleTime: 60_000,
  });
}

export function useSession(tenantId: string | null, sessionId: string | null) {
  return useQuery({
    queryKey: queryKeys.sessions.byId(tenantId ?? 'none', sessionId ?? 'none'),
    queryFn: () => fetchSession(sessionId as string),
    enabled: tenantId !== null && sessionId !== null,
    staleTime: 5_000,
  });
}

export function useStartSession(tenantId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: StartSessionInput) => startSession(input),
    onSuccess: async () => {
      if (tenantId) await invalidateSessionViews(queryClient, tenantId);
    },
  });
}

export function useCloseSession(tenantId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CloseSessionInput) => closeSession(input),
    onSuccess: async (_session, input) => {
      if (tenantId) await invalidateSessionViews(queryClient, tenantId, input.sessionId);
      // Selling items moved stock, so the catalogue is stale too.
      if (tenantId) {
        await queryClient.invalidateQueries({ queryKey: queryKeys.products.all(tenantId) });
      }
    },
  });
}

export function useCancelSession(tenantId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      sessionId,
      endedBy,
      reason,
    }: {
      sessionId: string;
      endedBy: string;
      reason: string;
    }) => cancelSession(sessionId, endedBy, reason),
    onSuccess: async (_s, vars) => {
      if (tenantId) await invalidateSessionViews(queryClient, tenantId, vars.sessionId);
    },
  });
}

/**
 * Flips a running session to TIME_COMPLETED. Called by the watcher hook when
 * the booked time elapses - it never ends the session.
 */
export function useMarkTimeCompleted(tenantId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) => markTimeCompleted(sessionId),
    onSuccess: async (_s, sessionId) => {
      if (tenantId) await invalidateSessionViews(queryClient, tenantId, sessionId);
    },
  });
}

export function useAddSessionItem(tenantId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: AddSessionItemInput) => addSessionItem(input),
    onSuccess: async (_item, input) => {
      if (!tenantId) return;
      await invalidateSessionViews(queryClient, tenantId, input.sessionId);
      await queryClient.invalidateQueries({ queryKey: queryKeys.products.all(tenantId) });
    },
  });
}

export function useUpdateSessionFrames(tenantId: string | null, sessionId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (framesPlayed: number) => updateSessionFrames(sessionId as string, framesPlayed),
    onSuccess: async () => {
      if (!tenantId) return;
      await invalidateSessionViews(queryClient, tenantId, sessionId ?? undefined);
    },
  });
}

export function useUpdateSessionItem(tenantId: string | null, sessionId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ itemId, quantity }: { itemId: string; quantity: number }) =>
      updateSessionItemQuantity(itemId, quantity),
    onSuccess: async () => {
      if (!tenantId) return;
      await invalidateSessionViews(queryClient, tenantId, sessionId ?? undefined);
      await queryClient.invalidateQueries({ queryKey: queryKeys.products.all(tenantId) });
    },
  });
}

export function useRemoveSessionItem(tenantId: string | null, sessionId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (itemId: string) => removeSessionItem(itemId),
    onSuccess: async () => {
      if (!tenantId) return;
      await invalidateSessionViews(queryClient, tenantId, sessionId ?? undefined);
      await queryClient.invalidateQueries({ queryKey: queryKeys.products.all(tenantId) });
    },
  });
}

/** Forces every session-derived view to refetch. */
export function useRefreshSessions(tenantId: string | null) {
  const queryClient = useQueryClient();
  return useCallback(async () => {
    if (tenantId) await invalidateSessionViews(queryClient, tenantId);
  }, [queryClient, tenantId]);
}
