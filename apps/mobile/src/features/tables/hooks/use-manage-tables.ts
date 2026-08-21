import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useRecordActivity } from '@/features/activity';
import { queryKeys } from '@/lib/query';

import {
  createClubTable,
  fetchAllClubTables,
  updateClubTable,
  type CreateClubTableInput,
  type UpdateClubTableInput,
} from '../api/tables.api';

/**
 * The owner's view of the table list.
 *
 * Separate from `useClubTables`, which powers the operational grid: that one
 * shows only active tables plus live occupancy and refetches every minute; this
 * one shows everything including retired tables and barely changes. Sharing a
 * cache entry between them would mean either the floor view refetching
 * configuration data all day, or the management list showing a stale roster.
 */
export function useManagedTables(tenantId: string | null) {
  return useQuery({
    queryKey: queryKeys.tables.managed(tenantId ?? 'none'),
    queryFn: () => fetchAllClubTables(tenantId as string),
    enabled: tenantId !== null,
    staleTime: 60_000,
  });
}

function useTableMutationSideEffects(tenantId: string | null) {
  const queryClient = useQueryClient();

  return async () => {
    // Both views of the same rows, plus the audit trail the owner just added to.
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.tables.managed(tenantId ?? 'none') }),
      queryClient.invalidateQueries({ queryKey: queryKeys.tables.overview(tenantId ?? 'none') }),
      queryClient.invalidateQueries({ queryKey: queryKeys.activity.all(tenantId ?? 'none') }),
    ]);
  };
}

export function useCreateClubTable(tenantId: string | null) {
  const settle = useTableMutationSideEffects(tenantId);
  const record = useRecordActivity(tenantId);

  return useMutation({
    mutationFn: (input: Omit<CreateClubTableInput, 'tenantId'>) =>
      createClubTable({ ...input, tenantId: tenantId as string }),
    onSuccess: async (table) => {
      await record({
        action: 'table.created',
        entityType: 'club_table',
        entityId: table.id,
        summary: `Added table ${table.name}`,
      });
      await settle();
    },
  });
}

export function useUpdateClubTable(tenantId: string | null) {
  const settle = useTableMutationSideEffects(tenantId);
  const record = useRecordActivity(tenantId);

  return useMutation({
    mutationFn: (input: UpdateClubTableInput) => updateClubTable(input),
    onSuccess: async (table, variables) => {
      // Activating and deactivating is the change an owner most often needs to
      // account for later, so it gets its own action rather than a generic one.
      const action =
        variables.isActive === undefined
          ? 'table.updated'
          : variables.isActive
            ? 'table.activated'
            : 'table.deactivated';

      await record({
        action,
        entityType: 'club_table',
        entityId: table.id,
        summary: `${table.name}${variables.isActive === false ? ' taken out of service' : ''}`,
      });
      await settle();
    },
  });
}
