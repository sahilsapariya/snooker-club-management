import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { queryKeys } from '@/lib/query';

import {
  createTenant,
  fetchAllTenants,
  fetchTenant,
  setTenantStatus,
  updateTenantBranding,
  type CreateTenantInput,
  type TenantStatus,
  type UpdateTenantBrandingInput,
} from '../api/tenants.api';

export function useTenants() {
  return useQuery({
    queryKey: queryKeys.platform.tenants(),
    queryFn: fetchAllTenants,
    staleTime: 60_000,
  });
}

export function useTenant(tenantId: string | null) {
  return useQuery({
    queryKey: queryKeys.platform.tenant(tenantId ?? 'none'),
    queryFn: () => fetchTenant(tenantId as string),
    enabled: tenantId !== null,
  });
}

export function useCreateTenant() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTenantInput) => createTenant(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.platform.tenants() });
    },
  });
}

export function useUpdateTenantBranding() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateTenantBrandingInput) => updateTenantBranding(input),
    onSuccess: async (tenant) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.platform.tenants() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.platform.tenant(tenant.id) }),
      ]);
    },
  });
}

export function useSetTenantStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ tenantId, status }: { tenantId: string; status: TenantStatus }) =>
      setTenantStatus(tenantId, status),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.platform.tenants() });
    },
  });
}
