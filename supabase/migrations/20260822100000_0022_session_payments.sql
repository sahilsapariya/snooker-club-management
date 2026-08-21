-- ============================================================================
-- 0022 · The payments ledger
-- ============================================================================
-- Until now a session carried one number and one method: `paid_amount_minor`
-- and `payment_method`. That is enough to close a session that is paid in full,
-- there and then, and it is wrong for everything else.
--
-- Two things break. A customer who pays half in cash and half by UPI has one of
-- those methods silently discarded. And a debt from Tuesday, settled in cash on
-- Friday, is attributed by `daily_cash_summary` to *Tuesday* - because it reads
-- the session's own business date. Friday's drawer would then be over by that
-- amount and Tuesday's retrospectively short, with nothing in the system
-- explaining either.
--
-- So payments become rows. `sessions.paid_amount_minor` stays exactly where it
-- is, and every reader of it keeps working - but it is now maintained from the
-- ledger rather than written directly, and the ledger records the thing the
-- till actually needs: how much arrived, by what means, and on which trading
-- day.

create table public.session_payments (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants (id) on delete cascade,
  session_id    uuid not null,
  amount_minor  bigint not null,
  method        public.payment_method not null,
  -- The day the money arrived, which is NOT the session's business date once a
  -- debt is settled later.
  --
  -- The default and the trigger are both needed, for different readers. The
  -- default exists so PostgREST marks the column optional - it cannot see
  -- triggers, and without it every client would be forced to send a value. The
  -- trigger exists so that a value sent anyway is discarded. Together, a client
  -- can neither omit the trading day nor choose it. Same pattern as
  -- `sessions.business_date`; see migration 0012.
  business_date date not null default current_date,
  note          text,
  received_by   uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),

  constraint session_payments_amount_positive check (amount_minor > 0),
  constraint session_payments_session_same_tenant
    foreign key (tenant_id, session_id)
    references public.sessions (tenant_id, id)
    on update cascade on delete cascade
);

create index session_payments_session_idx on public.session_payments (session_id, created_at);
create index session_payments_day_idx on public.session_payments (tenant_id, business_date);

comment on table public.session_payments is
  'Every payment against a session. Append-only for staff; the owner may delete one recorded in error.';
comment on column public.session_payments.business_date is
  'The trading day the money arrived. Differs from the session''s date whenever a debt is settled later.';

alter table public.session_payments enable row level security;

-- ---------------------------------------------------------------------------
-- The trading day is the server's to decide
-- ---------------------------------------------------------------------------
create or replace function app.session_payments_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_timezone    text;
  v_cutoff      time;
  v_outstanding bigint;
begin
  select t.timezone, t.business_day_cutoff
    into v_timezone, v_cutoff
    from public.tenants t
   where t.id = new.tenant_id;

  if v_timezone is null then
    raise exception 'unknown tenant %', new.tenant_id using errcode = '23503';
  end if;

  -- Both derived from the server clock, and neither accepted from the caller.
  --
  -- `created_at` is overwritten too, not just `business_date`. Deriving the day
  -- from a client-supplied timestamp would leave exactly the hole this trigger
  -- exists to close: a client could not name the till directly, but could pick
  -- a `created_at` that lands the payment in a different one - including a day
  -- already reconciled and signed off.
  new.created_at    := now();
  new.business_date := app.business_date(new.created_at, v_timezone, v_cutoff);

  -- Never accept more than is owed. If a customer hands over more, that is
  -- change, not a bigger payment - `settleSession` in the app already works
  -- that out. Without this, a fat-fingered amount silently creates a negative
  -- balance that no screen knows how to show.
  select s.total_amount_minor
         - coalesce((select sum(p.amount_minor) from public.session_payments p
                      where p.session_id = new.session_id), 0)
    into v_outstanding
    from public.sessions s
   where s.id = new.session_id;

  if v_outstanding is null then
    raise exception 'session % does not exist', new.session_id using errcode = '23503';
  end if;

  if new.amount_minor > v_outstanding then
    raise exception 'that is more than is owed on this session'
      using errcode = '23514',
            detail = format('outstanding %s, offered %s', v_outstanding, new.amount_minor),
            hint = 'Record what is owed and give the difference as change.';
  end if;

  return new;
end;
$$;

create trigger session_payments_before_write
  before insert on public.session_payments
  for each row execute function app.session_payments_before_write();

-- ---------------------------------------------------------------------------
-- The session's totals follow the ledger
-- ---------------------------------------------------------------------------
-- `paid_amount_minor` is no longer written by anybody; it is recomputed here
-- from the rows. That is what keeps the two from ever disagreeing - there is no
-- code path that can add a payment without the total moving, or move the total
-- without a payment to explain it.
--
-- WAIVED is left alone deliberately. It is a decision ("we are not chasing
-- this"), not an arithmetic outcome, and recomputing it from a zero balance
-- would quietly turn a waiver back into a debt.
create or replace function app.sync_session_payment_totals()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session_id uuid := coalesce(new.session_id, old.session_id);
  v_paid       bigint;
  v_total      bigint;
  v_method     public.payment_method;
  v_last_at    timestamptz;
  v_status     public.payment_status;
begin
  select coalesce(sum(p.amount_minor), 0)
    into v_paid
    from public.session_payments p
   where p.session_id = v_session_id;

  select p.method, p.created_at
    into v_method, v_last_at
    from public.session_payments p
   where p.session_id = v_session_id
   order by p.created_at desc, p.id desc
   limit 1;

  select s.total_amount_minor, s.payment_status
    into v_total, v_status
    from public.sessions s
   where s.id = v_session_id;

  if v_status = 'WAIVED' then
    return null;
  end if;

  update public.sessions s
     set paid_amount_minor = v_paid,
         payment_method    = v_method,
         paid_at           = v_last_at,
         -- Cast explicitly: `search_path = ''` means an unqualified literal
         -- has no enum to resolve against.
         payment_status    = (case
                               when v_paid <= 0 then 'UNPAID'
                               when v_paid >= v_total then 'PAID'
                               else 'PARTIALLY_PAID'
                             end)::public.payment_status
   where s.id = v_session_id;

  return null;
end;
$$;

create trigger session_payments_sync
  after insert or delete on public.session_payments
  for each row execute function app.sync_session_payment_totals();

-- ---------------------------------------------------------------------------
-- Backfill
-- ---------------------------------------------------------------------------
-- Every session already settled needs a ledger row, or the new reader would
-- report a day of takings as zero. The payment is dated to the session's own
-- business day, which is right: before this migration there was no way to pay
-- for a session on any other day.
--
-- The sync trigger is not wanted here - it would recompute values that are
-- already correct, and `created_at` is being set deliberately rather than
-- defaulted.
alter table public.session_payments disable trigger session_payments_sync;
alter table public.session_payments disable trigger session_payments_before_write;

insert into public.session_payments
  (tenant_id, session_id, amount_minor, method, business_date, note, received_by, created_at)
select
  s.tenant_id, s.id, s.paid_amount_minor, coalesce(s.payment_method, 'CASH'),
  s.business_date, 'Recorded before the payments ledger existed', s.ended_by,
  coalesce(s.paid_at, s.ended_at, s.created_at)
from public.sessions s
where s.paid_amount_minor > 0;

alter table public.session_payments enable trigger session_payments_sync;
alter table public.session_payments enable trigger session_payments_before_write;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
create policy "session payments: members read"
  on public.session_payments for select to authenticated
  using (app.can_read_tenant(tenant_id));

-- The receptionist taking the money is the one recording it, so the actor is
-- pinned the same way it is on the audit trail.
create policy "session payments: staff record"
  on public.session_payments for insert to authenticated
  with check (
    app.can_operate_tenant(tenant_id)
    and received_by = (select auth.uid())
  );

-- No UPDATE policy. A payment is a fact about money that changed hands; the
-- correction for a wrong one is to remove it and record the right one, which
-- leaves both actions in the audit trail.
create policy "session payments: owner removes a mistake"
  on public.session_payments for delete to authenticated
  using (app.is_tenant_owner(tenant_id));

grant select, insert, delete on public.session_payments to authenticated;
revoke update on public.session_payments from authenticated;
