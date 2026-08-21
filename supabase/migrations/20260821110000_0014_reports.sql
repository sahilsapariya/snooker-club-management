-- ============================================================================
-- 0014 · Reporting
-- ----------------------------------------------------------------------------
-- Aggregates for the reports screen. All of them are SECURITY INVOKER, which
-- for money reports is the whole ballgame: a definer function here would total
-- up another club's takings for anyone who could guess a tenant id. The
-- caller's RLS does the scoping, exactly as it does for a plain SELECT, and
-- migration tests assert that pointing one at another club returns zeros.
--
-- The work is done in Postgres rather than the client because summing a
-- quarter's sessions on a phone means shipping a quarter's sessions to it.
--
-- Every function takes an inclusive date range over the tenant-local *business*
-- date, not a timestamp range - a club trading past midnight would otherwise
-- see its late sessions land on the wrong day.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Headline numbers for a period
-- ---------------------------------------------------------------------------
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
  select
    count(*)::integer,
    coalesce(sum(s.total_amount_minor), 0)::bigint,
    coalesce(sum(s.discount_minor), 0)::bigint,
    coalesce(sum(s.paid_amount_minor), 0)::bigint,
    coalesce(sum(greatest(0, s.total_amount_minor - s.paid_amount_minor)), 0)::bigint,
    coalesce(sum(s.table_charge_minor), 0)::bigint,
    coalesce(sum(s.items_total_minor), 0)::bigint,
    coalesce(sum(s.paid_amount_minor) filter (where s.payment_method = 'CASH'), 0)::bigint,
    coalesce(sum(s.paid_amount_minor) filter (where s.payment_method is distinct from 'CASH'), 0)::bigint,
    case when count(*) = 0 then 0
         else (coalesce(sum(s.total_amount_minor), 0) / count(*))::bigint end,
    coalesce(sum(s.actual_duration_seconds), 0)::bigint,
    coalesce(sum(s.billable_duration_seconds), 0)::bigint
  from public.sessions s
  where s.tenant_id = p_tenant_id
    and s.business_date between p_from and p_to
    and s.status = 'CLOSED';
$$;

-- ---------------------------------------------------------------------------
-- Day-by-day trend, for the chart
-- ---------------------------------------------------------------------------
-- Generates every date in the range so days with no trading appear as zeros
-- rather than as gaps the chart would silently close up.
create or replace function public.report_daily_revenue(
  p_tenant_id uuid,
  p_from      date,
  p_to        date
)
returns table (
  business_date   date,
  sessions_count  integer,
  collected_minor bigint,
  expenses_minor  bigint,
  net_minor       bigint
)
language sql
stable
set search_path = ''
as $$
  with days as (
    select generate_series(p_from, p_to, interval '1 day')::date as day
  ),
  takings as (
    select s.business_date as day,
           count(*)::integer as sessions_count,
           coalesce(sum(s.paid_amount_minor), 0)::bigint as collected
    from public.sessions s
    where s.tenant_id = p_tenant_id
      and s.business_date between p_from and p_to
      and s.status = 'CLOSED'
    group by s.business_date
  ),
  spend as (
    select e.expense_date as day,
           coalesce(sum(e.amount_minor), 0)::bigint as spent
    from public.expenses e
    where e.tenant_id = p_tenant_id
      and e.expense_date between p_from and p_to
    group by e.expense_date
  )
  select
    d.day,
    coalesce(t.sessions_count, 0),
    coalesce(t.collected, 0)::bigint,
    coalesce(sp.spent, 0)::bigint,
    (coalesce(t.collected, 0) - coalesce(sp.spent, 0))::bigint
  from days d
  left join takings t on t.day = d.day
  left join spend sp on sp.day = d.day
  order by d.day;
$$;

-- ---------------------------------------------------------------------------
-- Which tables earn
-- ---------------------------------------------------------------------------
create or replace function public.report_table_performance(
  p_tenant_id uuid,
  p_from      date,
  p_to        date
)
returns table (
  table_id        uuid,
  table_name      text,
  table_type_name text,
  sessions_count  integer,
  collected_minor bigint,
  played_seconds  bigint
)
language sql
stable
set search_path = ''
as $$
  select
    ct.id,
    ct.name,
    tt.name,
    count(s.id)::integer,
    coalesce(sum(s.paid_amount_minor), 0)::bigint,
    coalesce(sum(s.actual_duration_seconds), 0)::bigint
  from public.club_tables ct
  join public.table_types tt on tt.id = ct.table_type_id
  left join public.sessions s
    on s.table_id = ct.id
   and s.status = 'CLOSED'
   and s.business_date between p_from and p_to
  where ct.tenant_id = p_tenant_id
  group by ct.id, ct.name, tt.name
  order by coalesce(sum(s.paid_amount_minor), 0) desc, ct.name;
$$;

-- ---------------------------------------------------------------------------
-- What sells
-- ---------------------------------------------------------------------------
-- Reads the snapshotted name and price on `session_items`, not the current
-- catalogue, so a renamed or repriced product still reports what was actually
-- sold at the time.
create or replace function public.report_product_sales(
  p_tenant_id uuid,
  p_from      date,
  p_to        date
)
returns table (
  product_id     uuid,
  product_name   text,
  quantity_sold  numeric,
  revenue_minor  bigint
)
language sql
stable
set search_path = ''
as $$
  select
    si.product_id,
    si.product_name_snapshot,
    coalesce(sum(si.quantity), 0)::numeric,
    coalesce(sum(si.line_total_minor), 0)::bigint
  from public.session_items si
  join public.sessions s on s.id = si.session_id
  where si.tenant_id = p_tenant_id
    and s.status = 'CLOSED'
    and s.business_date between p_from and p_to
  group by si.product_id, si.product_name_snapshot
  order by coalesce(sum(si.line_total_minor), 0) desc;
$$;

-- ---------------------------------------------------------------------------
-- Where the money went
-- ---------------------------------------------------------------------------
create or replace function public.report_expense_breakdown(
  p_tenant_id uuid,
  p_from      date,
  p_to        date
)
returns table (
  category_id   uuid,
  category_name text,
  entries_count integer,
  total_minor   bigint
)
language sql
stable
set search_path = ''
as $$
  select
    e.category_id,
    coalesce(ec.name, 'Uncategorised'),
    count(*)::integer,
    coalesce(sum(e.amount_minor), 0)::bigint
  from public.expenses e
  left join public.expense_categories ec on ec.id = e.category_id
  where e.tenant_id = p_tenant_id
    and e.expense_date between p_from and p_to
  group by e.category_id, ec.name
  order by coalesce(sum(e.amount_minor), 0) desc;
$$;

-- ---------------------------------------------------------------------------
-- Who still owes
-- ---------------------------------------------------------------------------
-- A view rather than a function because there is no range to parameterise:
-- an unpaid bill is outstanding until it is settled, whenever it was incurred.
create view public.v_outstanding_sessions
with (security_invoker = true) as
select
  s.id,
  s.tenant_id,
  s.business_date,
  s.customer_name,
  s.total_amount_minor,
  s.paid_amount_minor,
  (s.total_amount_minor - s.paid_amount_minor) as outstanding_minor,
  s.payment_status,
  s.ended_at,
  ct.name as table_name
from public.sessions s
join public.club_tables ct on ct.id = s.table_id
where s.status = 'CLOSED'
  and s.payment_status in ('UNPAID', 'PARTIALLY_PAID')
  and s.total_amount_minor > s.paid_amount_minor;

comment on view public.v_outstanding_sessions is
  'Closed sessions with money still owed. security_invoker=true so tenant RLS applies.';

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
grant execute on function public.report_revenue_summary(uuid, date, date)   to authenticated;
grant execute on function public.report_daily_revenue(uuid, date, date)     to authenticated;
grant execute on function public.report_table_performance(uuid, date, date) to authenticated;
grant execute on function public.report_product_sales(uuid, date, date)     to authenticated;
grant execute on function public.report_expense_breakdown(uuid, date, date) to authenticated;

grant select on public.v_outstanding_sessions to authenticated;
revoke insert, update, delete on public.v_outstanding_sessions from authenticated;
revoke all on public.v_outstanding_sessions from anon;

-- Supports every range scan above.
create index if not exists sessions_tenant_closed_date_idx
  on public.sessions (tenant_id, business_date)
  where status = 'CLOSED';
