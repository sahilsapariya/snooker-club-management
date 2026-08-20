-- ============================================================================
-- 0006 · Operations: sessions, session items, expenses, cash closing
-- ----------------------------------------------------------------------------
-- THE CENTRAL BUSINESS RULE OF THIS PRODUCT
-- -----------------------------------------
-- What actually happened and what the club decides to charge are two different
-- things, and the database must never let the second overwrite the first.
--
--   started_at / ended_at        immutable facts, recorded from the clock
--   actual_duration_seconds      GENERATED from those facts - there is no way
--                                to write to it, from any client, ever
--   billable_duration_seconds    a derived billing number, freely rewritable
--
-- A player booked for 60 minutes who plays 67 leaves an actual duration of
-- 4020 seconds on record regardless of what the grace period, rounding rule or
-- overtime mode decide to charge.
--
-- Related rule: a session never ends by itself. Passing the configured time
-- moves it to TIME_COMPLETED (an alertable *state*) and it stays open until a
-- receptionist explicitly closes it. The `sessions_terminal_state` constraint
-- enforces exactly that: open states have no ended_at, closed states must.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- sessions
-- ---------------------------------------------------------------------------
create table public.sessions (
  id                        uuid primary key default gen_random_uuid(),
  tenant_id                 uuid not null references public.tenants (id) on delete cascade,
  table_id                  uuid not null,
  pricing_rule_id           uuid,

  status                    public.session_status not null default 'ACTIVE',

  -- ---- Recorded facts (never derived from billing rules) ----
  started_at                timestamptz not null default now(),
  started_by                uuid references public.profiles (id) on delete set null,
  ended_at                  timestamptz,
  ended_by                  uuid references public.profiles (id) on delete set null,
  actual_duration_seconds   integer generated always as (
    case
      when ended_at is null then null
      else greatest(0, floor(extract(epoch from (ended_at - started_at)))::integer)
    end
  ) stored,

  -- ---- Billing (derived, rewritable) ----
  planned_duration_minutes  integer,
  time_completed_at         timestamptz,
  billable_duration_seconds integer,
  frames_played             integer not null default 0,
  -- The resolved billing rules + rate at the moment the session started, so a
  -- later price change cannot rewrite this bill.
  pricing_snapshot          jsonb not null default '{}'::jsonb,

  table_charge_minor        bigint not null default 0,
  items_total_minor         bigint not null default 0,
  discount_minor            bigint not null default 0,
  total_amount_minor        bigint generated always as (
    table_charge_minor + items_total_minor - discount_minor
  ) stored,

  -- ---- Payment ----
  payment_status            public.payment_status not null default 'UNPAID',
  payment_method            public.payment_method,
  paid_amount_minor         bigint not null default 0,
  paid_at                   timestamptz,

  business_date             date not null,
  customer_name             text,
  notes                     text,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),

  constraint sessions_end_after_start check (ended_at is null or ended_at >= started_at),
  -- Open sessions have no end; terminal sessions must have one.
  constraint sessions_terminal_state check (
    (status in ('ACTIVE', 'TIME_COMPLETED') and ended_at is null)
    or
    (status in ('CLOSED', 'CANCELLED') and ended_at is not null)
  ),
  constraint sessions_ended_by_requires_end check (ended_by is null or ended_at is not null),
  constraint sessions_planned_duration_positive
    check (planned_duration_minutes is null or planned_duration_minutes > 0),
  constraint sessions_billable_non_negative
    check (billable_duration_seconds is null or billable_duration_seconds >= 0),
  constraint sessions_frames_non_negative check (frames_played >= 0),
  constraint sessions_amounts_non_negative check (
    table_charge_minor >= 0 and items_total_minor >= 0
    and discount_minor >= 0 and paid_amount_minor >= 0
  ),
  constraint sessions_discount_within_charges
    check (discount_minor <= table_charge_minor + items_total_minor),
  constraint sessions_paid_requires_method
    check (payment_status <> 'PAID' or payment_method is not null),
  constraint sessions_paid_at_consistency
    check (paid_at is null or payment_status in ('PARTIALLY_PAID', 'PAID', 'WAIVED')),
  constraint sessions_snapshot_is_object check (jsonb_typeof(pricing_snapshot) = 'object'),

  constraint sessions_tenant_id_key unique (tenant_id, id),
  constraint sessions_table_same_tenant
    foreign key (tenant_id, table_id)
    references public.club_tables (tenant_id, id)
    on update cascade on delete no action,
  constraint sessions_pricing_rule_same_tenant
    foreign key (tenant_id, pricing_rule_id)
    references public.pricing_rules (tenant_id, id)
    on update cascade on delete no action
);

-- A physical table can host at most one open session at a time.
create unique index sessions_one_open_per_table
  on public.sessions (table_id)
  where status in ('ACTIVE', 'TIME_COMPLETED');

create index sessions_tenant_open_idx
  on public.sessions (tenant_id, started_at desc)
  where status in ('ACTIVE', 'TIME_COMPLETED');
create index sessions_tenant_business_date_idx on public.sessions (tenant_id, business_date desc);
create index sessions_tenant_payment_idx
  on public.sessions (tenant_id, payment_status)
  where payment_status <> 'PAID';
create index sessions_table_idx on public.sessions (table_id, started_at desc);

comment on column public.sessions.actual_duration_seconds is
  'GENERATED from started_at/ended_at. Structurally unwritable - billing rules can never overwrite the recorded truth.';
comment on column public.sessions.billable_duration_seconds is
  'Output of the billing engine (grace period, rounding, increments). Independent of actual_duration_seconds.';

create trigger sessions_set_updated_at
  before update on public.sessions
  for each row execute function app.set_updated_at();

alter table public.sessions enable row level security;

-- Stamp the tenant-local business date and protect the recorded facts.
create or replace function app.sessions_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_timezone text;
  v_cutoff   time;
begin
  if tg_op = 'INSERT' then
    select t.timezone, t.business_day_cutoff
      into v_timezone, v_cutoff
      from public.tenants t
     where t.id = new.tenant_id;

    if v_timezone is null then
      raise exception 'unknown tenant %', new.tenant_id using errcode = '23503';
    end if;

    new.business_date := coalesce(new.business_date, app.business_date(new.started_at, v_timezone, v_cutoff));

  elsif tg_op = 'UPDATE' then
    -- `started_at` is a recorded fact. Correcting one is an explicit,
    -- privileged action, not something an app screen may do.
    if new.started_at is distinct from old.started_at then
      raise exception 'session start time is immutable (session %)', old.id
        using errcode = '23514', hint = 'Cancel the session and start a new one instead.';
    end if;
    -- Once closed, a session's end time is fixed too.
    if old.ended_at is not null and new.ended_at is distinct from old.ended_at then
      raise exception 'session end time is immutable once the session is closed (session %)', old.id
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

create trigger sessions_before_write
  before insert or update on public.sessions
  for each row execute function app.sessions_before_write();

-- ---------------------------------------------------------------------------
-- session_items — food and drink attached to a running session
-- ---------------------------------------------------------------------------
-- Price and product name are SNAPSHOTTED at the moment of sale. Changing a
-- product's price tomorrow must not alter yesterday's bill, so the snapshot
-- columns are made immutable by trigger.
create table public.session_items (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenants (id) on delete cascade,
  session_id            uuid not null,
  product_id            uuid,

  product_name_snapshot text not null,
  unit_price_minor      bigint not null,
  quantity              numeric(12, 3) not null,
  line_total_minor      bigint generated always as (round(unit_price_minor * quantity)::bigint) stored,

  note                  text,
  added_by              uuid references public.profiles (id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint session_items_name_not_blank check (length(trim(product_name_snapshot)) > 0),
  constraint session_items_price_non_negative check (unit_price_minor >= 0),
  constraint session_items_quantity_positive check (quantity > 0),
  constraint session_items_session_same_tenant
    foreign key (tenant_id, session_id)
    references public.sessions (tenant_id, id)
    on update cascade on delete cascade,
  constraint session_items_product_same_tenant
    foreign key (tenant_id, product_id)
    references public.products (tenant_id, id)
    on update cascade on delete no action
);

create index session_items_session_idx on public.session_items (session_id, created_at);
create index session_items_product_idx on public.session_items (product_id) where product_id is not null;

comment on column public.session_items.unit_price_minor is
  'Price at the time of sale. Immutable after insert so historical bills never change.';

create trigger session_items_set_updated_at
  before update on public.session_items
  for each row execute function app.set_updated_at();

alter table public.session_items enable row level security;

create or replace function app.session_items_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product record;
  v_session record;
begin
  if tg_op = 'INSERT' then
    -- Snapshot from the product catalogue when the caller did not supply one.
    if new.product_id is not null then
      select p.name, p.selling_price_minor
        into v_product
        from public.products p
       where p.id = new.product_id and p.tenant_id = new.tenant_id;

      if v_product is null then
        raise exception 'product % does not belong to tenant %', new.product_id, new.tenant_id
          using errcode = '23503';
      end if;

      new.product_name_snapshot := coalesce(nullif(trim(new.product_name_snapshot), ''), v_product.name);
      new.unit_price_minor      := coalesce(new.unit_price_minor, v_product.selling_price_minor);
    end if;

    -- Items may only be attached to an open session.
    select s.status into v_session from public.sessions s where s.id = new.session_id;
    if v_session.status not in ('ACTIVE', 'TIME_COMPLETED') then
      raise exception 'cannot add items to a % session', v_session.status
        using errcode = '23514';
    end if;

  elsif tg_op = 'UPDATE' then
    if new.unit_price_minor is distinct from old.unit_price_minor
       or new.product_id is distinct from old.product_id
       or new.product_name_snapshot is distinct from old.product_name_snapshot then
      raise exception 'the price snapshot on a session item is immutable'
        using errcode = '23514',
              hint = 'Remove the line and add a new one if the sale was wrong.';
    end if;
  end if;

  return new;
end;
$$;

create trigger session_items_before_write
  before insert or update on public.session_items
  for each row execute function app.session_items_before_write();

-- Roll the line totals up onto the session, and post the matching stock
-- movement so the ledger can never drift from what was actually sold.
create or replace function app.session_items_after_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row        record := coalesce(new, old);
  v_qty_delta  numeric(12, 3);
  v_tracked    boolean;
begin
  update public.sessions s
     set items_total_minor = coalesce((
           select sum(si.line_total_minor)
             from public.session_items si
            where si.session_id = v_row.session_id
         ), 0)
   where s.id = v_row.session_id;

  -- Signed stock effect of this statement.
  v_qty_delta := case tg_op
                   when 'INSERT' then -new.quantity
                   when 'UPDATE' then -(new.quantity - old.quantity)
                   when 'DELETE' then old.quantity
                 end;

  if v_row.product_id is not null and v_qty_delta <> 0 then
    select p.track_inventory into v_tracked from public.products p where p.id = v_row.product_id;

    if coalesce(v_tracked, false) then
      insert into public.inventory_movements
        (tenant_id, product_id, movement_type, quantity_delta, reference_type, reference_id, created_by, note)
      values (
        v_row.tenant_id,
        v_row.product_id,
        case tg_op when 'INSERT' then 'SALE'::public.inventory_movement_type
                   else 'CORRECTION'::public.inventory_movement_type end,
        v_qty_delta,
        'session_item',
        v_row.id,
        coalesce(new.added_by, old.added_by),
        case tg_op when 'INSERT' then null else 'Adjustment from session item ' || tg_op end
      );
    end if;
  end if;

  return null;
end;
$$;

create trigger session_items_after_write
  after insert or update or delete on public.session_items
  for each row execute function app.session_items_after_write();

-- ---------------------------------------------------------------------------
-- expense_categories / expenses
-- ---------------------------------------------------------------------------
create table public.expense_categories (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants (id) on delete cascade,
  name       text not null,
  -- Seeded defaults are flagged so the UI can discourage deleting them.
  is_system  boolean not null default false,
  sort_order smallint not null default 0,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint expense_categories_name_not_blank check (length(trim(name)) > 0),
  constraint expense_categories_tenant_id_key unique (tenant_id, id)
);

create unique index expense_categories_unique_name
  on public.expense_categories (tenant_id, lower(name));

create trigger expense_categories_set_updated_at
  before update on public.expense_categories
  for each row execute function app.set_updated_at();

alter table public.expense_categories enable row level security;

create table public.expenses (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants (id) on delete cascade,
  category_id    uuid,
  amount_minor   bigint not null,
  -- The tenant-local business date the expense belongs to; drives cash closing.
  expense_date   date not null,
  payment_method public.payment_method not null default 'CASH',
  note           text,
  receipt_url    text,
  created_by     uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint expenses_amount_positive check (amount_minor > 0),
  constraint expenses_category_same_tenant
    foreign key (tenant_id, category_id)
    references public.expense_categories (tenant_id, id)
    on update cascade on delete no action
);

create index expenses_tenant_date_idx on public.expenses (tenant_id, expense_date desc);
create index expenses_category_idx on public.expenses (category_id) where category_id is not null;

create trigger expenses_set_updated_at
  before update on public.expenses
  for each row execute function app.set_updated_at();

alter table public.expenses enable row level security;

-- Default the expense date to the club's own business date, not the server's.
create or replace function app.expenses_set_business_date()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_timezone text;
  v_cutoff   time;
begin
  if new.expense_date is null then
    select t.timezone, t.business_day_cutoff
      into v_timezone, v_cutoff
      from public.tenants t
     where t.id = new.tenant_id;
    new.expense_date := app.business_date(now(), coalesce(v_timezone, 'UTC'), coalesce(v_cutoff, time '00:00'));
  end if;
  return new;
end;
$$;

create trigger expenses_set_business_date
  before insert on public.expenses
  for each row execute function app.expenses_set_business_date();

-- ---------------------------------------------------------------------------
-- cash_closings — end-of-day till reconciliation
-- ---------------------------------------------------------------------------
create table public.cash_closings (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references public.tenants (id) on delete cascade,
  business_date        date not null,

  opening_cash_minor   bigint not null default 0,
  cash_received_minor  bigint not null default 0,
  cash_expenses_minor  bigint not null default 0,
  expected_cash_minor  bigint generated always as (
    opening_cash_minor + cash_received_minor - cash_expenses_minor
  ) stored,
  actual_cash_minor    bigint,
  difference_minor     bigint generated always as (
    case
      when actual_cash_minor is null then null
      else actual_cash_minor - (opening_cash_minor + cash_received_minor - cash_expenses_minor)
    end
  ) stored,

  status               public.cash_closing_status not null default 'OPEN',
  opened_by            uuid references public.profiles (id) on delete set null,
  opened_at            timestamptz not null default now(),
  closed_by            uuid references public.profiles (id) on delete set null,
  closed_at            timestamptz,
  notes                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  constraint cash_closings_unique_day unique (tenant_id, business_date),
  constraint cash_closings_amounts_non_negative check (
    opening_cash_minor >= 0 and cash_received_minor >= 0
    and cash_expenses_minor >= 0 and (actual_cash_minor is null or actual_cash_minor >= 0)
  ),
  constraint cash_closings_closed_consistency check (
    (status = 'CLOSED') = (closed_at is not null)
  ),
  constraint cash_closings_closed_requires_count check (
    status <> 'CLOSED' or actual_cash_minor is not null
  )
);

create index cash_closings_tenant_date_idx on public.cash_closings (tenant_id, business_date desc);

create trigger cash_closings_set_updated_at
  before update on public.cash_closings
  for each row execute function app.set_updated_at();

alter table public.cash_closings enable row level security;
