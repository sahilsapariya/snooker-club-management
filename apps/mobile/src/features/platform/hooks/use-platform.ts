import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { queryKeys } from '@/lib/query';

import {
  assignOwner,
  createClub,
  fetchOwnerClubs,
  fetchPlatformClubs,
  fetchPlatformOverview,
  fetchPlatformOwners,
  setOwnerActive,
  type CreateClubInput,
} from '../api/platform.api';

/**
 * Platform-scoped queries.
 *
 * These deliberately live under a `['platform', …]` key prefix rather than
 * `['tenant', tenantId, …]`. Switching club evicts the tenant prefix wholesale
 * (see `useSwitchClub`), and platform data is not club data - it must survive
 * that, and must never be reachable from a club-scoped invalidation.
 */

export function usePlatformOverview() {
  return useQuery({
    queryKey: queryKeys.platform.overview(),
    queryFn: fetchPlatformOverview,
    staleTime: 60_000,
  });
}

export function usePlatformOwners() {
  return useQuery({
    queryKey: queryKeys.platform.owners(),
    queryFn: fetchPlatformOwners,
    staleTime: 60_000,
  });
}

export function useOwnerClubs(ownerUserId: string | null) {
  return useQuery({
    queryKey: queryKeys.platform.ownerClubs(ownerUserId ?? 'none'),
    queryFn: () => fetchOwnerClubs(ownerUserId as string),
    enabled: ownerUserId !== null,
    staleTime: 60_000,
  });
}

export function usePlatformClubs() {
  return useQuery({
    queryKey: queryKeys.platform.clubs(),
    queryFn: fetchPlatformClubs,
    staleTime: 60_000,
  });
}

/**
 * Creating a club also creates a membership, so both the club list and the
 * owner list are now wrong. Invalidating the whole `['platform']` prefix is the
 * honest move: the alternative is enumerating every derived count by hand and
 * quietly missing one.
 */
export function useCreateClub() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateClubInput) => createClub(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['platform'] });
    },
  });
}

export function useAssignOwner() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { tenantId: string; ownerEmail: string; replaceExisting: boolean }) =>
      assignOwner(params),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['platform'] });
    },
  });
}

export function useSetOwnerActive() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ ownerUserId, isActive }: { ownerUserId: string; isActive: boolean }) =>
      setOwnerActive(ownerUserId, isActive),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['platform'] });
    },
  });
}
