import type { ChargeResult } from '@/features/billing';
import { AppError, unwrap } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import type { Database } from '@/types/database.types';

type Tables = Database['public']['Tables'];

export type Session = Tables['sessions']['Row'];
export type SessionItem = Tables['session_items']['Row'];
export type PricingRule = Tables['pricing_rules']['Row'];
export type PaymentMethod = Database['public']['Enums']['payment_method'];
export type PaymentStatus = Database['public']['Enums']['payment_status'];

/** A session with the bits the UI always needs alongside it. */
export interface SessionWithContext extends Session {
  readonly club_table: { id: string; name: string; table_type_id: string } | null;
  readonly session_items: SessionItem[];
}

const SESSION_SELECT = '*, club_table:club_tables(id, name, table_type_id), session_items(*)';

/**
 * Sessions data access.
 *
 * Two constraints from the schema shape everything here:
 *
 *   1. `actual_duration_seconds` is a generated column. Nothing in this file
 *      may write it, and nothing tries.
 *   2. A session in `ACTIVE` or `TIME_COMPLETED` must have `ended_at` null, and
 *      a `CLOSED` one must have it set. The status and the timestamp therefore
 *      always move together, in a single update.
 */

export async function fetchOpenSessions(tenantId: string): Promise<SessionWithContext[]> {
  const result = await supabase
    .from('sessions')
    .select(SESSION_SELECT)
    .eq('tenant_id', tenantId)
    .in('status', ['ACTIVE', 'TIME_COMPLETED'])
    .order('started_at', { ascending: true });

  return (unwrap(result, 'load open sessions') ?? []) as SessionWithContext[];
}

export async function fetchSession(sessionId: string): Promise<SessionWithContext | null> {
  const result = await supabase
    .from('sessions')
    .select(SESSION_SELECT)
    .eq('id', sessionId)
    .maybeSingle();

  return unwrap(result, 'load session') as SessionWithContext | null;
}

export async function fetchRecentSessions(
  tenantId: string,
  limit = 30,
): Promise<SessionWithContext[]> {
  const result = await supabase
    .from('sessions')
    .select(SESSION_SELECT)
    .eq('tenant_id', tenantId)
    .in('status', ['CLOSED', 'CANCELLED'])
    .order('ended_at', { ascending: false })
    .limit(limit);

  return (unwrap(result, 'load recent sessions') ?? []) as SessionWithContext[];
}

/**
 * Picks the pricing rule that applies to a table, most specific first:
 * a rule for this exact table beats one for its type, which beats a club-wide
 * rule. Only active rules inside their validity window are considered.
 */
export async function resolvePricingRule(
  tenantId: string,
  tableId: string,
  tableTypeId: string,
): Promise<PricingRule | null> {
  const nowIso = new Date().toISOString();

  const result = await supabase
    .from('pricing_rules')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .lte('valid_from', nowIso)
    .or(`valid_to.is.null,valid_to.gt.${nowIso}`);

  const candidates = unwrap(result, 'load pricing rules') ?? [];

  const score = (rule: PricingRule): number => {
    if (rule.club_table_id === tableId) return 3;
    if (rule.table_type_id === tableTypeId) return 2;
    if (rule.club_table_id === null && rule.table_type_id === null) return 1;
    return 0;
  };

  const applicable = candidates
    .filter((rule) => score(rule) > 0)
    .sort((a, b) => {
      const byScope = score(b) - score(a);
      if (byScope !== 0) return byScope;
      // Prefer the club's chosen default, then the most recently valid rule.
      if (a.is_default !== b.is_default) return a.is_default ? -1 : 1;
      return Date.parse(b.valid_from) - Date.parse(a.valid_from);
    });

  return applicable[0] ?? null;
}

/**
 * Rebuilds the pricing rule a session was started under, from the snapshot
 * stored on the row.
 *
 * This is what makes the price stable. Reading the *live* rule instead would
 * mean a club that raises its rates at 8pm silently reprices every session
 * still running from 7pm - which is exactly the bug `pricing_snapshot` exists
 * to prevent. Returns null when the session started with no rule configured.
 */
export function pricingRuleFromSnapshot(snapshot: unknown): PricingRule | null {
  if (typeof snapshot !== 'object' || snapshot === null) return null;
  const s = snapshot as Record<string, unknown>;
  if (typeof s.rate_minor !== 'number' || typeof s.pricing_mode !== 'string') return null;

  const asNumberOrNull = (value: unknown): number | null =>
    typeof value === 'number' ? value : null;

  return {
    id: typeof s.pricing_rule_id === 'string' ? s.pricing_rule_id : 'snapshot',
    tenant_id: '',
    table_type_id: null,
    club_table_id: null,
    name: typeof s.name === 'string' ? s.name : 'Rate at start of session',
    pricing_mode: s.pricing_mode as PricingRule['pricing_mode'],
    rate_minor: s.rate_minor,
    increment_minutes: asNumberOrNull(s.increment_minutes),
    minimum_minutes: typeof s.minimum_minutes === 'number' ? s.minimum_minutes : 0,
    frame_price_minor: asNumberOrNull(s.frame_price_minor),
    is_default: false,
    is_active: true,
    valid_from: typeof s.captured_at === 'string' ? s.captured_at : new Date(0).toISOString(),
    valid_to: null,
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
  };
}

export interface StartSessionInput {
  readonly tenantId: string;
  readonly tableId: string;
  readonly tableTypeId: string;
  readonly startedBy: string;
  readonly plannedDurationMinutes: number | null;
  readonly customerName: string | null;
}

/**
 * Opens a session on a table.
 *
 * The resolved pricing rule is snapshotted onto the row. A club that raises its
 * prices this evening must not retroactively reprice a session that started
 * this afternoon, and the database keeps no other record of which rule applied.
 *
 * `ended_at` is deliberately absent: a `sessions_terminal_state` check
 * constraint makes an open session structurally incapable of having one.
 */
export async function startSession(input: StartSessionInput): Promise<Session> {
  const pricingRule = await resolvePricingRule(input.tenantId, input.tableId, input.tableTypeId);

  const result = await supabase
    .from('sessions')
    .insert({
      tenant_id: input.tenantId,
      table_id: input.tableId,
      pricing_rule_id: pricingRule?.id ?? null,
      status: 'ACTIVE',
      started_by: input.startedBy,
      planned_duration_minutes: input.plannedDurationMinutes,
      customer_name: input.customerName,
      pricing_snapshot: pricingRule
        ? {
            pricing_rule_id: pricingRule.id,
            name: pricingRule.name,
            pricing_mode: pricingRule.pricing_mode,
            rate_minor: pricingRule.rate_minor,
            increment_minutes: pricingRule.increment_minutes,
            minimum_minutes: pricingRule.minimum_minutes,
            frame_price_minor: pricingRule.frame_price_minor,
            captured_at: new Date().toISOString(),
          }
        : {},
    })
    .select('*')
    .single();

  return unwrap(result, 'start session');
}

/**
 * Marks that the booked time has elapsed.
 *
 * This does NOT end the session. `TIME_COMPLETED` is an open state that exists
 * so staff can be alerted; the clock keeps running and only an explicit close
 * sets `ended_at`.
 */
/**
 * Records frames as they are played.
 *
 * Written to the session rather than held in component state so the count
 * survives the sheet closing, is visible to whoever takes over the counter, and
 * is the same number the bill is computed from. It only ever affects the
 * charge; `actual_duration_seconds` is generated from the timestamps and is not
 * reachable from here.
 */
export async function updateSessionFrames(
  sessionId: string,
  framesPlayed: number,
): Promise<Session> {
  const result = await supabase
    .from('sessions')
    .update({ frames_played: Math.max(0, Math.floor(framesPlayed)) })
    .eq('id', sessionId)
    .in('status', ['ACTIVE', 'TIME_COMPLETED'])
    .select('*')
    .single();

  return unwrap(result, 'record frames');
}

export async function markTimeCompleted(sessionId: string): Promise<Session> {
  const result = await supabase
    .from('sessions')
    .update({ status: 'TIME_COMPLETED', time_completed_at: new Date().toISOString() })
    .eq('id', sessionId)
    .eq('status', 'ACTIVE')
    .select('*')
    .single();

  return unwrap(result, 'mark session time completed');
}

export interface CloseSessionInput {
  readonly sessionId: string;
  readonly endedBy: string;
  readonly charge: ChargeResult;
  /** Frames recorded during play. Priced already; written so the bill can be re-read. */
  readonly framesPlayed: number;
  readonly discountMinor: number;
  readonly payment: {
    readonly status: PaymentStatus;
    readonly method: PaymentMethod | null;
    readonly paidAmountMinor: number;
  };
  readonly notes: string | null;
}

/**
 * Ends a session and records what was charged.
 *
 * Note what is written and what is not: `billable_duration_seconds` and
 * `table_charge_minor` come from the billing engine, while
 * `actual_duration_seconds` and `total_amount_minor` are generated by Postgres
 * from the timestamps and the line items. Sending either would be rejected.
 */
export async function closeSession(input: CloseSessionInput): Promise<Session> {
  const endedAt = new Date().toISOString();

  const result = await supabase
    .from('sessions')
    .update({
      status: 'CLOSED',
      ended_at: endedAt,
      ended_by: input.endedBy,
      billable_duration_seconds: input.charge.billableSeconds,
      table_charge_minor: input.charge.tableChargeMinor,
      discount_minor: input.discountMinor,
      // Persisted from what was recorded, not reset. The engine has already
      // priced these frames into `table_charge_minor`, so writing 0 here would
      // leave a closed session whose charge nothing on the row explains.
      frames_played: Math.max(0, Math.floor(input.framesPlayed)),
      payment_status: input.payment.status,
      payment_method: input.payment.method,
      paid_amount_minor: input.payment.paidAmountMinor,
      paid_at: input.payment.paidAmountMinor > 0 ? endedAt : null,
      notes: input.notes,
    })
    .eq('id', input.sessionId)
    .in('status', ['ACTIVE', 'TIME_COMPLETED'])
    .select('*')
    .single();

  return unwrap(result, 'close session');
}

/** Abandons a session without billing it. Used for mistaken starts. */
export async function cancelSession(
  sessionId: string,
  endedBy: string,
  reason: string,
): Promise<Session> {
  const result = await supabase
    .from('sessions')
    .update({
      status: 'CANCELLED',
      ended_at: new Date().toISOString(),
      ended_by: endedBy,
      table_charge_minor: 0,
      billable_duration_seconds: 0,
      notes: reason,
    })
    .eq('id', sessionId)
    .in('status', ['ACTIVE', 'TIME_COMPLETED'])
    .select('*')
    .single();

  return unwrap(result, 'cancel session');
}

// ===========================================================================
// Session items
// ===========================================================================

export interface AddSessionItemInput {
  readonly tenantId: string;
  readonly sessionId: string;
  readonly productId: string;
  readonly quantity: number;
  readonly addedBy: string;
}

/**
 * Attaches a product to an open session.
 *
 * The price and product name are NOT sent: a database trigger snapshots them
 * from the catalogue at insert time, and refuses to let them change afterwards.
 * That keeps the snapshot honest even if a future caller tries to supply one.
 * The same trigger posts the matching stock movement.
 */
export async function addSessionItem(input: AddSessionItemInput): Promise<SessionItem> {
  if (input.quantity <= 0) {
    throw new AppError({
      code: 'validation',
      message: 'Quantity must be at least 1.',
      technicalMessage: `addSessionItem called with quantity ${input.quantity}`,
    });
  }

  const result = await supabase
    .from('session_items')
    .insert({
      tenant_id: input.tenantId,
      session_id: input.sessionId,
      product_id: input.productId,
      quantity: input.quantity,
      added_by: input.addedBy,
      // Placeholders; the trigger overwrites both from the catalogue.
      product_name_snapshot: '',
      unit_price_minor: null as unknown as number,
    })
    .select('*')
    .single();

  return unwrap(result, 'add item to session');
}

export async function updateSessionItemQuantity(
  itemId: string,
  quantity: number,
): Promise<SessionItem> {
  const result = await supabase
    .from('session_items')
    .update({ quantity })
    .eq('id', itemId)
    .select('*')
    .single();

  return unwrap(result, 'update item quantity');
}

export async function removeSessionItem(itemId: string): Promise<void> {
  const result = await supabase.from('session_items').delete().eq('id', itemId).select('id');
  unwrap(result, 'remove item from session');
}
