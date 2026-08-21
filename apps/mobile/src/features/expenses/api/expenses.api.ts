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

/**
 * Corrects an expense that was already recorded.
 *
 * Every field is optional because the common correction is one of them - a
 * mistyped amount, the wrong category, the wrong day. RLS decides whether the
 * caller may do it at all: the author or the club owner, nobody else.
 */
export interface UpdateExpenseInput {
  readonly expenseId: string;
  readonly categoryId?: string | null;
  readonly amountMinor?: number;
  readonly expenseDate?: string;
  readonly paymentMethod?: PaymentMethod;
  readonly note?: string | null;
}

export async function updateExpense(input: UpdateExpenseInput): Promise<Expense> {
  const result = await supabase
    .from('expenses')
    .update({
      // `undefined` means "not being changed". `null` is a real value here -
      // clearing a category or a note - so it must survive.
      ...(input.categoryId === undefined ? {} : { category_id: input.categoryId }),
      ...(input.amountMinor === undefined ? {} : { amount_minor: input.amountMinor }),
      ...(input.expenseDate === undefined ? {} : { expense_date: input.expenseDate }),
      ...(input.paymentMethod === undefined ? {} : { payment_method: input.paymentMethod }),
      ...(input.note === undefined ? {} : { note: input.note }),
    })
    .eq('id', input.expenseId)
    .select('*')
    .single();

  return unwrap(result, 'update expense');
}

export async function deleteExpense(expenseId: string): Promise<void> {
  const result = await supabase.from('expenses').delete().eq('id', expenseId).select('id');
  unwrap(result, 'delete expense');
}
