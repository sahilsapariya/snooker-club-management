import { unwrap } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import type { Database } from '@/types/database.types';

export type CashClosing = Database['public']['Tables']['cash_closings']['Row'];
export type DailyCashSummary =
  Database['public']['Functions']['daily_cash_summary']['Returns'][number];

/**
 * Cash closing: reconciling the drawer at the end of a trading day.
 *
 * The arithmetic lives in Postgres. `expected_cash_minor` and
 * `difference_minor` are generated columns, and `daily_cash_summary` adds up
 * the day's takings and spend server-side. Nothing here computes money the
 * database could compute itself, so two devices cannot disagree about the till.
 */

/** Takings and spend for a trading day, split by payment method. */
export async function fetchDailySummary(
  tenantId: string,
  businessDate: string,
): Promise<DailyCashSummary | null> {
  const result = await supabase
    .rpc('daily_cash_summary', { p_tenant_id: tenantId, p_business_date: businessDate })
    .maybeSingle();

  return unwrap(result, 'load daily cash summary');
}

export async function fetchCashClosing(
  tenantId: string,
  businessDate: string,
): Promise<CashClosing | null> {
  const result = await supabase
    .from('cash_closings')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('business_date', businessDate)
    .maybeSingle();

  return unwrap(result, 'load cash closing');
}

export async function fetchRecentClosings(tenantId: string, limit = 14): Promise<CashClosing[]> {
  const result = await supabase
    .from('cash_closings')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('business_date', { ascending: false })
    .limit(limit);

  return unwrap(result, 'load recent closings') ?? [];
}

export interface OpenTillInput {
  readonly tenantId: string;
  readonly businessDate: string;
  readonly openingCashMinor: number;
  readonly openedBy: string;
}

/**
 * Starts the day with a counted float.
 *
 * A unique constraint on (tenant_id, business_date) means a day can only be
 * opened once; upserting rather than inserting makes a double tap harmless.
 */
export async function openTill(input: OpenTillInput): Promise<CashClosing> {
  const result = await supabase
    .from('cash_closings')
    .upsert(
      {
        tenant_id: input.tenantId,
        business_date: input.businessDate,
        opening_cash_minor: input.openingCashMinor,
        opened_by: input.openedBy,
        status: 'OPEN',
      },
      { onConflict: 'tenant_id,business_date' },
    )
    .select('*')
    .single();

  return unwrap(result, 'open the till');
}

export interface CloseTillInput {
  readonly closingId: string;
  /** Takings and spend, taken from daily_cash_summary rather than the client. */
  readonly cashReceivedMinor: number;
  readonly cashExpensesMinor: number;
  /** What was physically counted in the drawer. */
  readonly actualCashMinor: number;
  readonly closedBy: string;
  readonly notes: string | null;
}

/**
 * Closes the day.
 *
 * `expected_cash_minor` and `difference_minor` are deliberately absent: both
 * are generated columns and Postgres rejects a supplied value. The client sends
 * only what it observed - the counted cash - and the database does the
 * subtraction, so a discrepancy cannot be papered over from the app.
 */
export async function closeTill(input: CloseTillInput): Promise<CashClosing> {
  const result = await supabase
    .from('cash_closings')
    .update({
      cash_received_minor: input.cashReceivedMinor,
      cash_expenses_minor: input.cashExpensesMinor,
      actual_cash_minor: input.actualCashMinor,
      status: 'CLOSED',
      closed_at: new Date().toISOString(),
      closed_by: input.closedBy,
      notes: input.notes,
    })
    .eq('id', input.closingId)
    .eq('status', 'OPEN')
    .select('*')
    .single();

  return unwrap(result, 'close the till');
}
