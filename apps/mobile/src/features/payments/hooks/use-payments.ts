import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { queryKeys } from '@/lib/query';

import {
  deletePayment,
  fetchOutstandingSessions,
  fetchSessionPayments,
  recordPayment,
  type RecordPaymentInput,
} from '../api/payments.api';

/**
 * Recording a payment moves more than the payment list.
 *
 * It changes the session's payment status, what is still owed, the day's cash
 * position and the reports over any range containing either date. Invalidating
 * the whole tenant prefix is the honest move: enumerating each derived figure
 * by hand is how one of them gets quietly missed.
 */
function useSettlePaymentSideEffects(tenantId: string | null) {
  const queryClient = useQueryClient();

  return async () => {
    if (!tenantId) return;
    await queryClient.invalidateQueries({ queryKey: ['tenant', tenantId] });
  };
}

export function useOutstandingSessions(tenantId: string | null) {
  return useQuery({
    queryKey: queryKeys.payments.outstanding(tenantId ?? 'none'),
    queryFn: () => fetchOutstandingSessions(tenantId as string),
    enabled: tenantId !== null,
    staleTime: 30_000,
  });
}

export function useSessionPayments(tenantId: string | null, sessionId: string | null) {
  return useQuery({
    queryKey: queryKeys.payments.forSession(tenantId ?? 'none', sessionId ?? 'none'),
    queryFn: () => fetchSessionPayments(sessionId as string),
    enabled: tenantId !== null && sessionId !== null,
    staleTime: 30_000,
  });
}

export function useRecordPayment(tenantId: string | null) {
  const settle = useSettlePaymentSideEffects(tenantId);

  return useMutation({
    mutationFn: (input: Omit<RecordPaymentInput, 'tenantId'>) =>
      recordPayment({ ...input, tenantId: tenantId as string }),
    onSuccess: settle,
  });
}

export function useDeletePayment(tenantId: string | null) {
  const settle = useSettlePaymentSideEffects(tenantId);

  return useMutation({
    mutationFn: (paymentId: string) => deletePayment(paymentId),
    onSuccess: settle,
  });
}
