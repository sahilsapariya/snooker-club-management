import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { queryKeys } from '@/lib/query';

import {
  createExpense,
  deleteExpense,
  fetchExpenseCategories,
  fetchExpenses,
  type CreateExpenseInput,
} from '../api/expenses.api';

export function useExpenses(tenantId: string | null) {
  return useQuery({
    queryKey: queryKeys.expenses.list(tenantId ?? 'none'),
    queryFn: () => fetchExpenses(tenantId as string),
    enabled: tenantId !== null,
    staleTime: 30_000,
  });
}

export function useExpenseCategories(tenantId: string | null) {
  return useQuery({
    queryKey: queryKeys.expenses.categories(tenantId ?? 'none'),
    queryFn: () => fetchExpenseCategories(tenantId as string),
    enabled: tenantId !== null,
    staleTime: 10 * 60_000,
  });
}

/**
 * Recording an expense changes the day's cash position, so the till summary is
 * invalidated alongside the list. Forgetting that would leave a receptionist
 * reconciling against a number that no longer includes what they just spent.
 */
export function useCreateExpense(tenantId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateExpenseInput) => createExpense(input),
    onSuccess: async (expense) => {
      if (!tenantId) return;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.expenses.list(tenantId) }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.cash.summary(tenantId, expense.expense_date),
        }),
      ]);
    },
  });
}

export function useDeleteExpense(tenantId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (expenseId: string) => deleteExpense(expenseId),
    onSuccess: async () => {
      if (!tenantId) return;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.expenses.list(tenantId) }),
        queryClient.invalidateQueries({ queryKey: ['tenant', tenantId, 'cash'] }),
      ]);
    },
  });
}
