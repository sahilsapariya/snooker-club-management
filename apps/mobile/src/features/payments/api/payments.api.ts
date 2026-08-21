import { unwrap } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import type { Database } from '@/types/database.types';

type Tables = Database['public']['Tables'];

export type SessionPayment = Tables['session_payments']['Row'];
export type OutstandingSession = Database['public']['Views']['v_outstanding_sessions']['Row'];
export type PaymentMethod = Database['public']['Enums']['payment_method'];

/**
 * Money against a session.
 *
 * Payments are rows, not a running total on the session. That matters for two
 * things the old single-column shape could not express:
 *
 *   * a bill settled half in cash and half by UPI, and
 *   * a debt settled days later, whose cash belongs in *that* day's drawer
 *     rather than the day the session closed.
 *
 * `sessions.paid_amount_minor` still exists and every reader of it still works
 * - but it is now recomputed from these rows by a trigger, so the two cannot
 * drift apart.
 */

/** Closed sessions with money still owed, oldest debt first. */
export async function fetchOutstandingSessions(tenantId: string): Promise<OutstandingSession[]> {
  const result = await supabase
    .from('v_outstanding_sessions')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('business_date', { ascending: true })
    .order('ended_at', { ascending: true });

  return unwrap(result, 'load outstanding balances') ?? [];
}

export async function fetchSessionPayments(sessionId: string): Promise<SessionPayment[]> {
  const result = await supabase
    .from('session_payments')
    .select('*')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true });

  return unwrap(result, 'load payments') ?? [];
}

export interface RecordPaymentInput {
  readonly tenantId: string;
  readonly sessionId: string;
  readonly amountMinor: number;
  readonly method: PaymentMethod;
  readonly note: string | null;
  readonly receivedBy: string;
}

/**
 * Records money taken against an already-closed session.
 *
 * A plain insert rather than an RPC: the insert policy already says exactly the
 * right thing (`can_operate_tenant`, and `received_by` must be the caller), and
 * the table's own trigger stamps the trading day and refuses more than is owed.
 * Wrapping that in a function would only give the rules somewhere else to live.
 *
 * Neither the date nor the timestamp is sent. Both are set by the server, so a
 * client cannot land a payment in a till that has already been counted.
 */
export async function recordPayment(input: RecordPaymentInput): Promise<SessionPayment> {
  const result = await supabase
    .from('session_payments')
    .insert({
      tenant_id: input.tenantId,
      session_id: input.sessionId,
      amount_minor: input.amountMinor,
      method: input.method,
      note: input.note,
      received_by: input.receivedBy,
    })
    .select('*')
    .single();

  return unwrap(result, 'record payment');
}

/**
 * Removes a payment recorded in error. Owner only, enforced by policy.
 *
 * There is no edit. A payment is a fact about money that changed hands; the
 * correction is to remove the wrong one and record the right one, which leaves
 * both actions visible rather than silently rewriting history.
 */
export async function deletePayment(paymentId: string): Promise<void> {
  const result = await supabase.from('session_payments').delete().eq('id', paymentId).select('id');

  unwrap(result, 'remove payment');
}
