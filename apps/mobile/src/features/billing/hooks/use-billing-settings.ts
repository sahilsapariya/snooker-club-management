import { useMutation, useQueryClient } from '@tanstack/react-query';

import { useRecordActivity } from '@/features/activity';
import { queryKeys } from '@/lib/query';

import {
  updateBillingSettings,
  type UpdateBillingSettingsInput,
} from '../api/billing-settings.api';

/**
 * Saving billing rules invalidates more than it looks like it should.
 *
 * A rule change does not re-price a session that has already started - each one
 * carries its own `pricing_snapshot` taken at the moment it began - but it does
 * change what every *running* session will be charged when it closes, and the
 * session sheet recomputes live. So the session lists have to be refreshed too,
 * or staff would watch a stale total until the next background refetch.
 */
export function useUpdateBillingSettings(tenantId: string | null) {
  const queryClient = useQueryClient();
  const record = useRecordActivity(tenantId);

  return useMutation({
    mutationFn: (input: Omit<UpdateBillingSettingsInput, 'tenantId'>) =>
      updateBillingSettings({ ...input, tenantId: tenantId as string }),
    onSuccess: async (_settings, variables) => {
      await record({
        action: 'billing_settings.updated',
        entityType: 'tenant_billing_settings',
        summary: 'Billing rules changed',
        metadata: { fields: Object.keys(variables) },
      });

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.billing.settings(tenantId ?? 'none') }),
        queryClient.invalidateQueries({ queryKey: queryKeys.sessions.all(tenantId ?? 'none') }),
        queryClient.invalidateQueries({ queryKey: queryKeys.activity.all(tenantId ?? 'none') }),
      ]);
    },
  });
}
