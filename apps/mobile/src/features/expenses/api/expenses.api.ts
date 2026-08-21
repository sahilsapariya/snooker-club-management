import { unwrap } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import type { Database } from '@/types/database.types';

export type Expense = Database['public']['Tables']['expenses']['Row'];
export type ExpenseCategory = Database['public']['Tables']['expense_categories']['Row'];
export type PaymentMethod = Database['public']['Enums']['payment_method'];

export interface ExpenseWithCategory extends Expense {
  readonly category: { id: string; name: string } | null;
}

const EXPENSE_SELECT = '*, category:expense_categories(id, name)';

/**
 * Expenses.
 *
 * `expense_date` is sent explicitly rather than defaulted, because an expense
 * legitimately belongs to a date the user chooses - recording yesterday's
 * electricity bill this morning is normal. That is the opposite of
 * `sessions.business_date`, which the server always derives; a session happened
 * when it happened.
 *
 * RLS lets any member record one, but only the author or an owner may edit it.
 */

export async function fetchExpenses(
  tenantId: string,
  options: { readonly from?: string; readonly to?: string; readonly limit?: number } = {},
): Promise<ExpenseWithCategory[]> {
  let query = supabase
    .from('expenses')
    .select(EXPENSE_SELECT)
    .eq('tenant_id', tenantId)
    .order('expense_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(options.limit ?? 100);

  if (options.from) query = query.gte('expense_date', options.from);
  if (options.to) query = query.lte('expense_date', options.to);

  return (unwrap(await query, 'load expenses') ?? []) as ExpenseWithCategory[];
}

export async function fetchExpenseCategories(tenantId: string): Promise<ExpenseCategory[]> {
  const result = await supabase
    .from('expense_categories')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .order('sort_order', { ascending: true });

  return unwrap(result, 'load expense categories') ?? [];
}

export interface CreateExpenseInput {
  readonly tenantId: string;
  readonly categoryId: string | null;
  readonly amountMinor: number;
  readonly expenseDate: string;
  readonly paymentMethod: PaymentMethod;
  readonly note: string | null;
  readonly createdBy: string;
}

export async function createExpense(input: CreateExpenseInput): Promise<Expense> {
  const result = await supabase
    .from('expenses')
    .insert({
      tenant_id: input.tenantId,
      category_id: input.categoryId,
      amount_minor: input.amountMinor,
      expense_date: input.expenseDate,
      payment_method: input.paymentMethod,
      note: input.note,
      created_by: input.createdBy,
    })
    .select('*')
    .single();

  return unwrap(result, 'record expense');
}

export async function deleteExpense(expenseId: string): Promise<void> {
  const result = await supabase.from('expenses').delete().eq('id', expenseId).select('id');
  unwrap(result, 'delete expense');
}
