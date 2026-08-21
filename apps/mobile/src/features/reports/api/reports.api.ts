import { unwrap } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import type { Database } from '@/types/database.types';

type Fn = Database['public']['Functions'];

export type RevenueSummary = Fn['report_revenue_summary']['Returns'][number];
export type DailyRevenue = Fn['report_daily_revenue']['Returns'][number];
export type TablePerformance = Fn['report_table_performance']['Returns'][number];
export type ProductSales = Fn['report_product_sales']['Returns'][number];
export type ExpenseBreakdown = Fn['report_expense_breakdown']['Returns'][number];
export type OutstandingSession = Database['public']['Views']['v_outstanding_sessions']['Row'];

export interface ReportRange {
  readonly tenantId: string;
  readonly from: string;
  readonly to: string;
}

/**
 * Reporting data access.
 *
 * Every call is an RPC that aggregates in Postgres rather than a SELECT the
 * client sums itself - a quarter of sessions should not be shipped to a phone
 * just to be added up. All of the functions are SECURITY INVOKER, so a member
 * of one club gets zeros if they point one at another club's id.
 */

export async function fetchRevenueSummary(range: ReportRange): Promise<RevenueSummary | null> {
  const result = await supabase
    .rpc('report_revenue_summary', {
      p_tenant_id: range.tenantId,
      p_from: range.from,
      p_to: range.to,
    })
    .maybeSingle();

  return unwrap(result, 'load revenue summary');
}

export async function fetchDailyRevenue(range: ReportRange): Promise<DailyRevenue[]> {
  const result = await supabase.rpc('report_daily_revenue', {
    p_tenant_id: range.tenantId,
    p_from: range.from,
    p_to: range.to,
  });

  return unwrap(result, 'load daily revenue') ?? [];
}

export async function fetchTablePerformance(range: ReportRange): Promise<TablePerformance[]> {
  const result = await supabase.rpc('report_table_performance', {
    p_tenant_id: range.tenantId,
    p_from: range.from,
    p_to: range.to,
  });

  return unwrap(result, 'load table performance') ?? [];
}

export async function fetchProductSales(range: ReportRange): Promise<ProductSales[]> {
  const result = await supabase.rpc('report_product_sales', {
    p_tenant_id: range.tenantId,
    p_from: range.from,
    p_to: range.to,
  });

  return unwrap(result, 'load product sales') ?? [];
}

export async function fetchExpenseBreakdown(range: ReportRange): Promise<ExpenseBreakdown[]> {
  const result = await supabase.rpc('report_expense_breakdown', {
    p_tenant_id: range.tenantId,
    p_from: range.from,
    p_to: range.to,
  });

  return unwrap(result, 'load expense breakdown') ?? [];
}

/**
 * Money still owed, across all time.
 *
 * Deliberately not range-filtered: a bill from three weeks ago is still
 * outstanding today, and hiding it behind a date picker is how debts get
 * forgotten.
 */
export async function fetchOutstandingSessions(tenantId: string): Promise<OutstandingSession[]> {
  const result = await supabase
    .from('v_outstanding_sessions')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('business_date', { ascending: false })
    .limit(50);

  return unwrap(result, 'load outstanding balances') ?? [];
}
