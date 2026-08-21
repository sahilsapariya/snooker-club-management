-- ============================================================================
-- 0023 · Money reads follow the ledger
-- ============================================================================
-- With payments now recorded as rows, two readers were quietly wrong and one
-- notification fired at the wrong moment.
--
-- The wrongness was invisible while every session was paid once, in full, on
-- the day it closed - which is exactly the case the old columns were shaped
-- for. It becomes visible the first time somebody pays half in cash and half by
-- UPI, or settles a debt a week later.
--
-- Two different questions are being answered here and they are easy to
-- conflate, so each function now says which one it is answering:
--
--   Cash reconciliation  ... by the day the MONEY ARRIVED.
--                            The drawer holds what came in today.
--   Revenue reporting    ... by the day the TRADE HAPPENED.
--                            Tuesday earned what Tuesday billed, whenever it
--                            is eventually collected.

-- ---------------------------------------------------------------------------
-- daily_cash_summary — the drawer
-- ---------------------------------------------------------------------------
-- Cash and non-cash now come from `session_payments`, filtered by the payment's
-- own business date. Before this, a Tuesday debt settled in cash on Friday was
-- counted into *Tuesday's* takings: Friday's drawer came up over by that
-- amount, Tuesday's retrospectively short, and nothing in the system explained
-- either.
--
-- `outstanding_minor` still keys off the session's date, and deliberately: it
-- answers "what did this day's trade leave uncollected", which self-corrects as
-- debts are settled. It is information, not part of the reconciliation.
create or replace function public.daily_cash_summary(
  p_tenant_id     uuid,
  p_business_date date
)
returns table (
  business_date            date,
  sessions_closed          integer,
  cash_received_minor      bigint,
  non_cash_received_minor  bigint,
  total_received_minor     bigint,
  outstanding_minor        bigint,
  cash_expenses_minor      bigint,
  non_cash_expenses_minor  bigint,
  total_expenses_minor     bigint
)
language sql
stable
set search_path = ''
as $$
  with trade as (
    select
      count(*)::integer as sessions_closed,
      coalesce(sum(greatest(0, s.total_amount_minor - s.paid_amount_minor)), 0)::bigint
        as outstanding
    from public.sessions s
    where s.tenant_id = p_tenant_id
      and s.business_date = p_business_date
      and s.status = 'CLOSED'
  ),
  money_in as (
    select
      coalesce(sum(p.amount_minor) filter (where p.method = 'CASH'), 0)::bigint
        as cash_received,
      coalesce(sum(p.amount_minor) filter (where p.method <> 'CASH'), 0)::bigint
        as non_cash_received
    from public.session_payments p
    where p.tenant_id = p_tenant_id
      and p.business_date = p_business_date
  ),
  spend as (
    select
      coalesce(sum(e.amount_minor) filter (where e.payment_method = 'CASH'), 0)::bigint
        as cash_expenses,
      coalesce(sum(e.amount_minor) filter (where e.payment_method is distinct from 'CASH'), 0)::bigint
        as non_cash_expenses
    from public.expenses e
    where e.tenant_id = p_tenant_id
      and e.expense_date = p_business_date
  )
  select
    p_business_date,
    t.sessions_closed,
    m.cash_received,
    m.non_cash_received,
    (m.cash_received + m.non_cash_received)::bigint,
    t.outstanding,
    s.cash_expenses,
    s.non_cash_expenses,
    (s.cash_expenses + s.non_cash_expenses)::bigint
  from trade t cross join money_in m cross join spend s;
$$;

comment on function public.daily_cash_summary(uuid, date) is
  'The day''s drawer. Cash is counted by the day the money arrived, not the day the session closed.';

-- ---------------------------------------------------------------------------
-- report_revenue_summary — the trade
-- ---------------------------------------------------------------------------
-- Only the cash/non-cash split changes. It used to read
-- `sum(paid_amount_minor) filter (where payment_method = 'CASH')`, which
-- attributes a whole bill to whichever method happened to be used last - so a
-- session paid 250 cash and 190 by UPI counted 440 as UPI and nothing as cash.
--
-- The range still filters on the session's business date. This is a report
-- about trade, so a debt settled next month still belongs to the day it was
-- earned.
create or replace function public.report_revenue_summary(
  p_tenant_id uuid,
  p_from      date,
  p_to        date
)
returns table (
  sessions_count       integer,
  gross_minor          bigint,
  discount_minor       bigint,
  collected_minor      bigint,
  outstanding_minor    bigint,
  table_charge_minor   bigint,
  items_minor          bigint,
  cash_minor           bigint,
  non_cash_minor       bigint,
  average_session_minor bigint,
  -- Reported side by side on purpose: the gap between them is the club's
  -- rounding and grace policy made visible.
  played_seconds       bigint,
  billed_seconds       bigint
)
language sql
stable
set search_path = ''
as $$
  with scoped as (
    select s.*
    from public.sessions s
    where s.tenant_id = p_tenant_id
      and s.business_date between p_from and p_to
      and s.status = 'CLOSED'
  ),
  split as (
    select
      coalesce(sum(p.amount_minor) filter (where p.method = 'CASH'), 0)::bigint as cash,
      coalesce(sum(p.amount_minor) filter (where p.method <> 'CASH'), 0)::bigint as non_cash
    from public.session_payments p
    join scoped s on s.id = p.session_id
  )
  select
    count(*)::integer,
    coalesce(sum(s.total_amount_minor), 0)::bigint,
    coalesce(sum(s.discount_minor), 0)::bigint,
    coalesce(sum(s.paid_amount_minor), 0)::bigint,
    coalesce(sum(greatest(0, s.total_amount_minor - s.paid_amount_minor)), 0)::bigint,
    coalesce(sum(s.table_charge_minor), 0)::bigint,
    coalesce(sum(s.items_total_minor), 0)::bigint,
    (select cash from split),
    (select non_cash from split),
    case when count(*) = 0 then 0
         else (coalesce(sum(s.total_amount_minor), 0) / count(*))::bigint end,
    coalesce(sum(s.actual_duration_seconds), 0)::bigint,
    coalesce(sum(s.billable_duration_seconds), 0)::bigint
  from scoped s;
$$;

comment on function public.report_revenue_summary(uuid, date, date) is
  'Trade in a date range, by the day the session closed. Cash split comes from the payments ledger.';

-- ---------------------------------------------------------------------------
-- The payment notification belongs on the payment
-- ---------------------------------------------------------------------------
-- It used to fire on `sessions.payment_status` changing, which misses the case
-- an owner most wants to know about: a second part-payment that leaves the
-- session still PARTIALLY_PAID. Money arrived and nobody was told.
--
-- The ledger row *is* the event, so the trigger moves onto it.
drop trigger if exists sessions_notify_payment on public.sessions;

create or replace function app.notify_payment_recorded()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_enabled boolean;
  v_minor   integer;
begin
  select notify_on_payment into v_enabled
    from public.tenant_billing_settings where tenant_id = new.tenant_id;
  if v_enabled is distinct from true then
    return null;
  end if;

  select currency_minor_units into v_minor
    from public.tenants where id = new.tenant_id;

  perform app.notify_club(
    new.tenant_id,
    'PAYMENT_RECEIVED',
    format('%s: payment received', app.club_name(new.tenant_id)),
    format('%s by %s.',
           trim(to_char(new.amount_minor / power(10, coalesce(v_minor, 2)), 'FM999G999G990D00')),
           lower(new.method::text)),
    'OWNERS',
    'session', new.session_id,
    jsonb_build_object('session_id', new.session_id, 'amount_minor', new.amount_minor,
                       'method', new.method, 'business_date', new.business_date),
    -- Never tell the receptionist who just took the money that money was taken.
    new.received_by
  );

  return null;
end;
$$;

create trigger session_payments_notify
  after insert on public.session_payments
  for each row execute function app.notify_payment_recorded();
