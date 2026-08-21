import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { queryKeys } from '@/lib/query';

import {
  createPricingRule,
  fetchPricingRules,
  setPricingRuleActive,
  updateBillingSettings,
  updatePricingRule,
  type BillingSettings,
  type UpsertPricingRuleInput,
} from '../api/pricing.api';

export function usePricingRules(tenantId: string | null) {
  return useQuery({
    queryKey: queryKeys.pricing.rules(tenantId ?? 'none'),
    queryFn: () => fetchPricingRules(tenantId as string),
    enabled: tenantId !== null,
    staleTime: 60_000,
  });
}

function useRulesInvalidator(tenantId: string | null) {
  const queryClient = useQueryClient();
  return async () => {
    if (!tenantId) return;
    await queryClient.invalidateQueries({ queryKey: queryKeys.pricing.rules(tenantId) });
  };
}

export function useCreatePricingRule(tenantId: string | null) {
  const invalidate = useRulesInvalidator(tenantId);
  return useMutation({
    mutationFn: (input: UpsertPricingRuleInput) => createPricingRule(input),
    onSuccess: invalidate,
  });
}

export function useUpdatePricingRule(tenantId: string | null) {
  const invalidate = useRulesInvalidator(tenantId);
  return useMutation({
    mutationFn: (input: UpsertPricingRuleInput & { id: string }) => updatePricingRule(input),
    onSuccess: invalidate,
  });
}

export function useSetPricingRuleActive(tenantId: string | null) {
  const invalidate = useRulesInvalidator(tenantId);
  return useMutation({
    mutationFn: ({ ruleId, isActive }: { ruleId: string; isActive: boolean }) =>
      setPricingRuleActive(ruleId, isActive),
    onSuccess: invalidate,
  });
}

/**
 * Billing rules change how future sessions are priced. Running sessions keep
 * the snapshot they started with, so the session context is refreshed rather
 * than the open sessions being repriced.
 */
export function useUpdateBillingSettings(tenantId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: Parameters<typeof updateBillingSettings>[1]) =>
      updateBillingSettings(tenantId as string, patch),
    onSuccess: async (_settings: BillingSettings) => {
      await queryClient.invalidateQueries({ queryKey: ['session-context'] });
    },
  });
}
