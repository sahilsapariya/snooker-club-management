import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useRecordActivity } from '@/features/activity';
import { queryKeys } from '@/lib/query';

import {
  createEquipment,
  fetchEquipment,
  updateEquipment,
  type CreateEquipmentInput,
  type UpdateEquipmentInput,
} from '../api/equipment.api';

export function useEquipment(tenantId: string | null) {
  return useQuery({
    queryKey: queryKeys.equipment.all(tenantId ?? 'none'),
    queryFn: () => fetchEquipment(tenantId as string),
    enabled: tenantId !== null,
    staleTime: 60_000,
  });
}

export function useCreateEquipment(tenantId: string | null) {
  const queryClient = useQueryClient();
  const record = useRecordActivity(tenantId);

  return useMutation({
    mutationFn: (input: Omit<CreateEquipmentInput, 'tenantId'>) =>
      createEquipment({ ...input, tenantId: tenantId as string }),
    onSuccess: async (item) => {
      await record({
        action: 'equipment.added',
        entityType: 'equipment',
        entityId: item.id,
        summary: `Added ${item.name}`,
      });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.equipment.all(tenantId ?? 'none'),
      });
    },
  });
}

/**
 * Condition changes get their own audit action.
 *
 * "Who marked this cue damaged, and when" is the question an owner actually
 * asks - a generic `equipment.updated` alongside a price correction would not
 * answer it.
 */
export function useUpdateEquipment(tenantId: string | null) {
  const queryClient = useQueryClient();
  const record = useRecordActivity(tenantId);

  return useMutation({
    mutationFn: (input: UpdateEquipmentInput) => updateEquipment(input),
    onSuccess: async (item, variables) => {
      const conditionOnly =
        variables.status !== undefined &&
        Object.keys(variables).every((key) => ['equipmentId', 'status', 'notes'].includes(key));

      await record({
        action: conditionOnly ? 'equipment.condition_changed' : 'equipment.updated',
        entityType: 'equipment',
        entityId: item.id,
        summary: conditionOnly
          ? `${item.name} marked ${item.status.toLowerCase().replace('_', ' ')}`
          : `Updated ${item.name}`,
      });

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.equipment.all(tenantId ?? 'none') }),
        queryClient.invalidateQueries({ queryKey: queryKeys.activity.all(tenantId ?? 'none') }),
      ]);
    },
  });
}
