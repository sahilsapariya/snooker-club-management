-- ============================================================================
-- 0004 · Club configuration
-- ----------------------------------------------------------------------------
-- Billing rules, table types, physical tables and pricing rules.
--
-- Cross-tenant integrity note
-- ---------------------------
-- Child rows carry `tenant_id` and reference their parent through a COMPOSITE
-- foreign key `(tenant_id, parent_id)`. Combined with a `unique (tenant_id, id)`
-- on every parent, this makes it structurally impossible for a row to point at
-- another tenant's row - a guarantee that holds even if an RLS policy is ever
-- written incorrectly.
--
-- The composite FKs use ON DELETE NO ACTION (checked at end-of-statement)
-- rather than RESTRICT (checked immediately) so that deleting a tenant can
-- still cascade cleanly through the whole graph in a single statement.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- tenant_billing_settings — how this club turns elapsed time into money
-- ---------------------------------------------------------------------------
-- These are BILLING RULES ONLY. They never influence what is recorded as the
-- actual session duration; see public.sessions.actual_duration_seconds.
create table public.tenant_billing_settings (
  tenant_id                  uuid primary key references public.tenants (id) on delete cascade,

  -- Time -> billable time
  time_calculation_mode      public.time_calculation_mode not null default 'FIXED_INCREMENT',
  billing_increment_minutes  integer not null default 30,
  minimum_billable_minutes   integer not null default 0,
  -- Ordered slabs for CUSTOM_SLABS, e.g.
  -- [{"up_to_minutes":60,"price_minor":15000},{"up_to_minutes":null,"price_minor":25000}]
  custom_slabs               jsonb not null default '[]'::jsonb,

  -- Rounding applied to billable minutes
  rounding_mode              public.rounding_mode not null default 'ROUND_UP',
  rounding_increment_minutes integer not null default 1,

  -- Free minutes tolerated past the configured time before overtime starts
  grace_period_minutes       integer not null default 5,

  -- Overtime
  overtime_mode              public.overtime_mode not null default 'SAME_RATE',
  overtime_rate_minor        bigint,
  overtime_increment_minutes integer,

  -- Frame billing (snooker clubs that charge per frame instead of per minute)
  frame_billing_enabled      boolean not null default false,
  default_frame_price_minor  bigint,

  -- Operational toggles
  notify_on_time_completed   boolean not null default true,
  notify_on_payment          boolean not null default true,
  low_stock_alerts_enabled   boolean not null default true,

  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),

  constraint billing_increment_positive     check (billing_increment_minutes > 0),
  constraint billing_minimum_non_negative   check (minimum_billable_minutes >= 0),
  constraint billing_rounding_positive      check (rounding_increment_minutes > 0),
  constraint billing_grace_non_negative     check (grace_period_minutes >= 0),
  constraint billing_overtime_rate_valid    check (overtime_rate_minor is null or overtime_rate_minor >= 0),
  constraint billing_overtime_increment_valid
    check (overtime_increment_minutes is null or overtime_increment_minutes > 0),
  constraint billing_frame_price_valid      check (default_frame_price_minor is null or default_frame_price_minor >= 0),
  constraint billing_custom_slabs_is_array  check (jsonb_typeof(custom_slabs) = 'array'),
  -- Mode-specific requirements
  constraint billing_overtime_rate_required
    check (overtime_mode <> 'OVERTIME_RATE' or overtime_rate_minor is not null),
  constraint billing_overtime_increment_required
    check (overtime_mode <> 'INCREMENT_BLOCK' or overtime_increment_minutes is not null),
  constraint billing_slabs_required
    check (time_calculation_mode <> 'CUSTOM_SLABS' or jsonb_array_length(custom_slabs) > 0),
  constraint billing_frame_price_required
    check (not frame_billing_enabled or default_frame_price_minor is not null)
);

comment on table public.tenant_billing_settings is
  'Per-club billing rules. One row per tenant, created automatically by the tenant provisioning trigger.';

create trigger tenant_billing_settings_set_updated_at
  before update on public.tenant_billing_settings
  for each row execute function app.set_updated_at();

alter table public.tenant_billing_settings enable row level security;

-- ---------------------------------------------------------------------------
-- table_types — extensible catalogue of what kind of table a club has
-- ---------------------------------------------------------------------------
-- POOL_SMALL / POOL_REGULAR / SNOOKER ship as seeded rows, not as an enum, so a
-- club can add "English Billiards" or "Carrom" without a schema migration.
create table public.table_types (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants (id) on delete cascade,
  code       text not null,
  name       text not null,
  description text,
  sort_order smallint not null default 0,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint table_types_code_format check (code ~ '^[A-Z][A-Z0-9_]{1,39}$'),
  constraint table_types_name_not_blank check (length(trim(name)) > 0),
  constraint table_types_unique_code unique (tenant_id, code),
  -- Enables composite foreign keys from child tables.
  constraint table_types_tenant_id_key unique (tenant_id, id)
);

create index table_types_tenant_idx on public.table_types (tenant_id, sort_order);

create trigger table_types_set_updated_at
  before update on public.table_types
  for each row execute function app.set_updated_at();

alter table public.table_types enable row level security;

-- ---------------------------------------------------------------------------
-- club_tables — the physical tables on the floor
-- ---------------------------------------------------------------------------
create table public.club_tables (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants (id) on delete cascade,
  table_type_id uuid not null,
  name          text not null,
  table_number  integer,
  status        public.club_table_status not null default 'AVAILABLE',
  is_active     boolean not null default true,
  notes         text,
  sort_order    smallint not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint club_tables_name_not_blank check (length(trim(name)) > 0),
  constraint club_tables_number_positive check (table_number is null or table_number > 0),
  constraint club_tables_unique_name unique (tenant_id, name),
  constraint club_tables_tenant_id_key unique (tenant_id, id),
  constraint club_tables_type_same_tenant
    foreign key (tenant_id, table_type_id)
    references public.table_types (tenant_id, id)
    on update cascade on delete no action
);

create unique index club_tables_unique_number
  on public.club_tables (tenant_id, table_number)
  where table_number is not null;

create index club_tables_tenant_idx on public.club_tables (tenant_id, sort_order, name);

comment on table public.club_tables is
  'Physical playing tables. `status` is availability; occupancy is derived from open sessions, never stored here.';

create trigger club_tables_set_updated_at
  before update on public.club_tables
  for each row execute function app.set_updated_at();

alter table public.club_tables enable row level security;

-- ---------------------------------------------------------------------------
-- pricing_rules — configurable, never hard-coded
-- ---------------------------------------------------------------------------
-- A rule may target a table type, a single table, or the whole club (both null).
-- `valid_from` / `valid_to` let a club change prices without rewriting history:
-- a session snapshots the rule it used at start time.
create table public.pricing_rules (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants (id) on delete cascade,
  table_type_id      uuid,
  club_table_id      uuid,

  name               text not null,
  pricing_mode       public.pricing_mode not null default 'PER_HOUR',
  rate_minor         bigint not null default 0,
  increment_minutes  integer,
  minimum_minutes    integer not null default 0,
  frame_price_minor  bigint,

  is_default         boolean not null default false,
  is_active          boolean not null default true,
  valid_from         timestamptz not null default now(),
  valid_to           timestamptz,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint pricing_rules_name_not_blank check (length(trim(name)) > 0),
  constraint pricing_rules_rate_non_negative check (rate_minor >= 0),
  constraint pricing_rules_minimum_non_negative check (minimum_minutes >= 0),
  constraint pricing_rules_increment_positive check (increment_minutes is null or increment_minutes > 0),
  constraint pricing_rules_frame_price_valid check (frame_price_minor is null or frame_price_minor >= 0),
  constraint pricing_rules_validity_window check (valid_to is null or valid_to > valid_from),
  constraint pricing_rules_increment_required
    check (pricing_mode <> 'FIXED_INCREMENT' or increment_minutes is not null),
  constraint pricing_rules_frame_price_required
    check (pricing_mode <> 'PER_FRAME' or frame_price_minor is not null),
  -- A rule targets a type OR a specific table, not both.
  constraint pricing_rules_single_target
    check (table_type_id is null or club_table_id is null),

  constraint pricing_rules_tenant_id_key unique (tenant_id, id),
  constraint pricing_rules_type_same_tenant
    foreign key (tenant_id, table_type_id)
    references public.table_types (tenant_id, id)
    on update cascade on delete no action,
  constraint pricing_rules_table_same_tenant
    foreign key (tenant_id, club_table_id)
    references public.club_tables (tenant_id, id)
    on update cascade on delete no action
);

-- At most one active default per scope (club-wide, per type, or per table).
create unique index pricing_rules_one_default_per_scope
  on public.pricing_rules (
    tenant_id,
    coalesce(table_type_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(club_table_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  where is_default and is_active;

create index pricing_rules_lookup_idx
  on public.pricing_rules (tenant_id, table_type_id, is_active, valid_from desc);

comment on table public.pricing_rules is
  'Tenant-configurable pricing. Sessions snapshot the resolved rule so later price changes never rewrite old bills.';

create trigger pricing_rules_set_updated_at
  before update on public.pricing_rules
  for each row execute function app.set_updated_at();

alter table public.pricing_rules enable row level security;
