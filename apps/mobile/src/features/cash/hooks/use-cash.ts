import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { queryKeys } from '@/lib/query';

import {
  closeTill,
  fetchCashClosing,
  fetchDailySummary,
  fetchRecentClosings,
  openTill,
  type CloseTillInput,
  type OpenTillInput,
} from '../api/cash.api';

export function useDailySummary(tenantId: string | null, businessDate: string) {
  return useQuery({
    queryKey: queryKeys.cash.summary(tenantId ?? 'none', businessDate),
    queryFn: () => fetchDailySummary(tenantId as string, businessDate),
    enabled: tenantId !== null,
    // Every closed session moves this, so it is kept short-lived and is also
    // invalidated explicitly when a session closes or an expense is recorded.
    staleTime: 15_000,
  });
}

export function useCashClosing(tenantId: string | null, businessDate: string) {
  return useQuery({
    queryKey: queryKeys.cash.closing(tenantId ?? 'none', businessDate),
    queryFn: () => fetchCashClosing(tenantId as string, businessDate),
    enabled: tenantId !== null,
    staleTime: 15_000,
  });
}

export function useRecentClosings(tenantId: string | null) {
  return useQuery({
    queryKey: queryKeys.cash.recent(tenantId ?? 'none'),
    queryFn: () => fetchRecentClosings(tenantId as string),
    enabled: tenantId !== null,
    staleTime: 60_000,
  });
}

export function useOpenTill(tenantId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: OpenTillInput) => openTill(input),
    onSuccess: async () => {
      if (tenantId) {
        await queryClient.invalidateQueries({ queryKey: ['tenant', tenantId, 'cash'] });
      }
    },
  });
}

export function useCloseTill(tenantId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CloseTillInput) => closeTill(input),
    onSuccess: async () => {
      if (tenantId) {
        await queryClient.invalidateQueries({ queryKey: ['tenant', tenantId, 'cash'] });
      }
    },
  });
}
