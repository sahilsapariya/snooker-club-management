import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { queryKeys } from '@/lib/query';

import {
  addStaffMember,
  fetchStaff,
  setStaffStatus,
  type MembershipStatus,
  type TenantRole,
} from '../api/staff.api';

export function useStaff(tenantId: string | null) {
  return useQuery({
    queryKey: queryKeys.staff.list(tenantId ?? 'none'),
    queryFn: () => fetchStaff(tenantId as string),
    enabled: tenantId !== null,
    staleTime: 60_000,
  });
}

export function useAddStaffMember(tenantId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { email: string; role: TenantRole }) =>
      addStaffMember({ tenantId: tenantId as string, ...params }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.staff.list(tenantId ?? 'none') }),
        queryClient.invalidateQueries({ queryKey: queryKeys.activity.all(tenantId ?? 'none') }),
      ]);
    },
  });
}

export function useSetStaffStatus(tenantId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { membershipId: string; status: MembershipStatus }) =>
      setStaffStatus(params),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.staff.list(tenantId ?? 'none') }),
        queryClient.invalidateQueries({ queryKey: queryKeys.activity.all(tenantId ?? 'none') }),
      ]);
    },
  });
}
