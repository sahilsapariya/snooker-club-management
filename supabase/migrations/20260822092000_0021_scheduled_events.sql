-- ============================================================================
-- 0021 · Scheduled events
-- ============================================================================
-- Two things have to happen without anybody holding a phone.
--
-- The app already flips a session to TIME_COMPLETED when its booked time
-- elapses, but only for whoever has the app open. That is a convenience, not a
-- guarantee: a club that closes the app, or a receptionist on the shop floor,
-- would never see the transition and never be told. The sweep below is the
-- durable version of the same rule.
--
-- Both functions are written to be safe to run at any frequency: running them
-- twice in a minute produces exactly the same result as running them once.
-- Scheduling is an operations concern (see docs/notifications.md); the
-- functions are the contract.

-- ---------------------------------------------------------------------------
-- app.sweep_time_completed_sessions
-- ---------------------------------------------------------------------------
-- Marks every session whose booked time has elapsed. It does NOT end them - the
-- clock keeps running and only a receptionist closes a session. All this changes
-- is a status, which turns the table amber and (via the trigger in 0019) tells
-- somebody to look at it.
--
-- Idempotent by construction: the update is conditional on the row still being
-- ACTIVE, so a second run in the same minute matches nothing, and two workers
-- racing produce one transition and one notification.
create or replace function app.sweep_time_completed_sessions()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.sessions s
     set status = 'TIME_COMPLETED',
         time_completed_at = now()
    from public.tenants t
   where t.id = s.tenant_id
     and t.status in ('TRIAL', 'ACTIVE')
     and s.status = 'ACTIVE'
     and s.planned_duration_minutes is not null
     and s.started_at + make_interval(mins => s.planned_duration_minutes) <= now();

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function app.sweep_time_completed_sessions() is
  'Flags sessions whose booked time has elapsed. Never ends a session. Idempotent.';

-- ---------------------------------------------------------------------------
-- app.remind_unclosed_tills
-- ---------------------------------------------------------------------------
-- A club that never reconciles its drawer discovers the discrepancy weeks later,
-- when nobody can remember the day. This nudges once per club per unreconciled
-- day, and once only.
--
-- "Yesterday" is the club's own trading day, not the server's calendar day: a
-- club whose day ends at 02:00 has not finished yesterday until 02:00.
create or replace function app.remind_unclosed_tills()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_club   record;
  v_date   date;
  v_count  integer := 0;
begin
  for v_club in
    select id, name, timezone, business_day_cutoff
      from public.tenants
     where status in ('TRIAL', 'ACTIVE')
  loop
    v_date := app.business_date(now(), v_club.timezone, v_club.business_day_cutoff) - 1;

    -- Nothing to reconcile if the club did no trade and spent nothing.
    if not exists (
      select 1 from public.sessions
       where tenant_id = v_club.id and business_date = v_date
      union all
      select 1 from public.expenses
       where tenant_id = v_club.id and expense_date = v_date
    ) then
      continue;
    end if;

    if exists (
      select 1 from public.cash_closings
       where tenant_id = v_club.id and business_date = v_date and status = 'CLOSED'
    ) then
      continue;
    end if;

    -- One reminder per club per day. Keyed on the notification already in the
    -- table rather than on a separate "reminded" flag, so the record of having
    -- nagged and the nag itself cannot disagree.
    if exists (
      select 1 from public.notifications
       where tenant_id = v_club.id
         and type = 'CASH_CLOSING_REMINDER'
         and metadata ->> 'business_date' = v_date::text
    ) then
      continue;
    end if;

    perform app.notify_club(
      v_club.id,
      'CASH_CLOSING_REMINDER',
      format('%s: cash closing is due', v_club.name),
      format('The till for %s has not been reconciled yet.', v_date),
      'OWNERS',
      'cash_closing', null,
      jsonb_build_object('business_date', v_date)
    );

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

comment on function app.remind_unclosed_tills() is
  'One reminder per club per unreconciled trading day, using the club''s own day boundary. Idempotent.';

-- ---------------------------------------------------------------------------
-- public.run_scheduled_maintenance — one entry point for the scheduler
-- ---------------------------------------------------------------------------
-- Exposed so a hosted scheduler (pg_cron, an Edge Function on a timer, or an
-- external job runner) has a single thing to call, rather than every deployment
-- inventing its own list. Service role only - this is not a client operation.
create or replace function public.run_scheduled_maintenance()
returns table (sessions_flagged integer, tills_reminded integer)
language sql
security definer
set search_path = ''
as $$
  select app.sweep_time_completed_sessions(), app.remind_unclosed_tills();
$$;

comment on function public.run_scheduled_maintenance() is
  'Service-role only. Runs every periodic job. Safe to call at any frequency.';

revoke all on function public.run_scheduled_maintenance() from public;
grant execute on function public.run_scheduled_maintenance() to service_role;

revoke all on function app.sweep_time_completed_sessions() from public;
revoke all on function app.remind_unclosed_tills()         from public;
