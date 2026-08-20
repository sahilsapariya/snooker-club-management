import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { queryKeys } from '@/lib/query';

import { fetchClubTableOverview, fetchTableTypes, type ClubTableOverview } from '../api/tables.api';

export interface ClubTablesSummary {
  readonly total: number;
  readonly active: number;
  readonly occupied: number;
  readonly available: number;
  readonly needingAttention: number;
}

export function useClubTables(tenantId: string | null) {
  const query = useQuery({
    queryKey: queryKeys.tables.overview(tenantId ?? 'none'),
    queryFn: () => fetchClubTableOverview(tenantId as string),
    enabled: tenantId !== null,
    // Occupancy changes as staff start and end sessions, so this is kept
    // fresher than static configuration data.
    staleTime: 15_000,
    refetchInterval: 60_000,
  });

  const summary = useMemo<ClubTablesSummary>(() => summarise(query.data ?? []), [query.data]);

  // Fields are picked explicitly rather than spread: spreading a TanStack query
  // subscribes the component to every field on it, including ones like
  // `dataUpdatedAt` that change on each background refetch and would re-render
  // the whole table list for nothing.
  return {
    data: query.data,
    isPending: query.isPending,
    isError: query.isError,
    error: query.error,
    isRefetching: query.isRefetching,
    refetch: query.refetch,
    summary,
  };
}

export function useTableTypes(tenantId: string | null) {
  return useQuery({
    queryKey: queryKeys.tables.types(tenantId ?? 'none'),
    queryFn: () => fetchTableTypes(tenantId as string),
    enabled: tenantId !== null,
    staleTime: 10 * 60_000,
  });
}

function summarise(tables: readonly ClubTableOverview[]): ClubTablesSummary {
  let active = 0;
  let occupied = 0;
  let available = 0;
  let needingAttention = 0;

  for (const table of tables) {
    if (table.is_active !== true) continue;
    active += 1;

    if (table.is_occupied === true) {
      occupied += 1;
      // A session past its booked time is a state to surface, never a reason
      // for the app to end it.
      if (table.active_session_status === 'TIME_COMPLETED') needingAttention += 1;
    } else if (table.status === 'AVAILABLE') {
      available += 1;
    } else {
      needingAttention += 1;
    }
  }

  return { total: tables.length, active, occupied, available, needingAttention };
}
