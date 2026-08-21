-- ============================================================================
-- 0013 · Daily cash summary
-- ----------------------------------------------------------------------------
-- Cash closing asks a simple question: how much money should be in the till?
-- Answering it means adding up a day's takings and subtracting the day's cash
-- expenses, split by payment method - only cash movements affect the drawer.
--
-- Doing that in the client would mean pulling every session and expense for the
-- day to the phone just to sum them, and would let two devices disagree. This
-- function keeps the arithmetic next to the data.
--
-- SECURITY INVOKER (the default) on purpose: it must run with the caller's
-- privileges so RLS still scopes the numbers to their own club. It is NOT a
-- definer function - that would hand any member a cross-tenant total.
-- ============================================================================

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
  with takings as (
    select
      count(*)::integer as sessions_closed,
      coalesce(sum(s.paid_amount_minor) filter (where s.payment_method = 'CASH'), 0)::bigint
        as cash_received,
      coalesce(sum(s.paid_amount_minor) filter (where s.payment_method is distinct from 'CASH'), 0)::bigint
        as non_cash_received,
      -- What was billed but not collected: the day's debt, not its takings.
      coalesce(sum(greatest(0, s.total_amount_minor - s.paid_amount_minor)), 0)::bigint
        as outstanding
    from public.sessions s
    where s.tenant_id = p_tenant_id
      and s.business_date = p_business_date
      and s.status = 'CLOSED'
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
    t.cash_received,
    t.non_cash_received,
    (t.cash_received + t.non_cash_received)::bigint,
    t.outstanding,
    s.cash_expenses,
    s.non_cash_expenses,
    (s.cash_expenses + s.non_cash_expenses)::bigint
  from takings t cross join spend s;
$$;

comment on function public.daily_cash_summary(uuid, date) is
  'Takings and spend for one trading day, split by payment method. SECURITY INVOKER so RLS still applies.';

grant execute on function public.daily_cash_summary(uuid, date) to authenticated;

-- Supports both the summary above and the expenses list screen.
create index if not exists expenses_tenant_date_method_idx
  on public.expenses (tenant_id, expense_date, payment_method);
