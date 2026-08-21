import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { queryKeys } from '@/lib/query';

import {
  createExpense,
  deleteExpense,
  fetchExpenseCategories,
  fetchExpenses,
  updateExpense,
  type CreateExpenseInput,
  type UpdateExpenseInput,
} from '../api/expenses.api';

/** A closed date range, or the whole recent history when both ends are absent. */
export interface ExpenseRange {
  readonly from?: string;
  readonly to?: string;
}

/**
 * Expenses, optionally narrowed to a date range.
 *
 * The range is part of the query key, so each range is cached separately rather
 * than the list flickering between filters - and every key still starts
 * `['tenant', tenantId, …]`, so switching club evicts all of them together.
 */
export function useExpenses(tenantId: string | null, range: ExpenseRange = {}) {
  const { from = 'all', to = 'all' } = range;

  return useQuery({
    queryKey: [...queryKeys.expenses.list(tenantId ?? 'none'), from, to],
    queryFn: () => fetchExpenses(tenantId as string, { from, to }),
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

/**
 * Corrects an expense.
 *
 * Both dates are invalidated, not just the new one: moving an expense from
 * Tuesday to Wednesday changes what both days' tills should hold, and
 * refreshing only the destination would leave Tuesday quietly overstated.
 */
export function useUpdateExpense(tenantId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateExpenseInput & { readonly previousDate: string }) =>
      updateExpense(input),
    onSuccess: async (expense, variables) => {
      if (!tenantId) return;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.expenses.list(tenantId) }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.cash.summary(tenantId, expense.expense_date),
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.cash.summary(tenantId, variables.previousDate),
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
