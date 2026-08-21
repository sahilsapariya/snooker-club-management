-- ============================================================================
-- 0024 · Closing a session is one transaction
-- ============================================================================
-- Closing used to be a single UPDATE that set the status, the charge and the
-- payment together. With payments in their own table that is two writes, and
-- two writes from a phone are two chances to end up half-done: a session closed
-- and marked paid with no money recorded against it, or money recorded against
-- a session that never closed.
--
-- Neither is acceptable at a counter with a customer standing at it, so the
-- pair moves into the database.
--
-- SECURITY INVOKER: every check that governs this already exists as policy on
-- the two tables it writes. Making it DEFINER would mean re-implementing them,
-- and re-implemented authorization is authorization that drifts.
create or replace function public.close_session(
  p_session_id           uuid,
  p_billable_seconds     integer,
  p_table_charge_minor   bigint,
  p_discount_minor       bigint default 0,
  p_frames_played        integer default 0,
  p_payment_amount_minor bigint default 0,
  p_payment_method       public.payment_method default null,
  p_notes                text default null
)
returns public.sessions
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_session public.sessions;
begin
  if p_payment_amount_minor > 0 and p_payment_method is null then
    raise exception 'a payment needs a method' using errcode = '23514';
  end if;

  -- Note what is NOT written here: `payment_status`, `paid_amount_minor`,
  -- `payment_method` and `paid_at`. Those belong to the ledger now, and are
  -- recomputed by its trigger. Setting them here would let the session disagree
  -- with the payments behind it.
  --
  -- `actual_duration_seconds` and `total_amount_minor` are generated columns;
  -- Postgres refuses a write to either.
  update public.sessions s
     set status                    = 'CLOSED',
         ended_at                  = now(),
         ended_by                  = (select auth.uid()),
         billable_duration_seconds = greatest(0, p_billable_seconds),
         table_charge_minor        = greatest(0, p_table_charge_minor),
         discount_minor            = greatest(0, p_discount_minor),
         frames_played             = greatest(0, p_frames_played),
         notes                     = p_notes
   where s.id = p_session_id
     and s.status in ('ACTIVE', 'TIME_COMPLETED')
  returning * into v_session;

  if v_session.id is null then
    raise exception 'session % is not open', p_session_id
      using errcode = 'P0002', hint = 'It may already be closed.';
  end if;

  if p_payment_amount_minor > 0 then
    -- The ledger's own trigger stamps the trading day and refuses an amount
    -- greater than the bill, so nothing needs re-checking here.
    insert into public.session_payments
      (tenant_id, session_id, amount_minor, method, received_by)
    values
      (v_session.tenant_id, v_session.id, p_payment_amount_minor, p_payment_method,
       (select auth.uid()));

    -- Re-read: the sync trigger has just rewritten the payment columns.
    select * into v_session from public.sessions where id = p_session_id;
  end if;

  return v_session;
end;
$$;

comment on function public.close_session(uuid, integer, bigint, bigint, integer, bigint, public.payment_method, text) is
  'Ends a session and records what was taken, in one transaction. Payment columns are left to the ledger trigger.';

grant execute on function public.close_session(uuid, integer, bigint, bigint, integer, bigint, public.payment_method, text)
  to authenticated;
