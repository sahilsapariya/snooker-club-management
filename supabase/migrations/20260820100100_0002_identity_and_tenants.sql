-- ============================================================================
-- 0002 · Identity, tenants and memberships
-- ----------------------------------------------------------------------------
-- The authorization spine of the product:
--
--   auth.users ──1:1──> public.profiles
--                          │
--                          ├──> public.platform_admins   (product-owner level)
--                          └──> public.tenant_memberships (club level)
--                                        │
--                                        └──> public.tenants
--
-- Row Level Security is enabled here but policies are declared in migration
-- 0009. Between the two, every table denies all access, which is the safe
-- direction to fail.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- profiles — application-visible mirror of auth.users
-- ---------------------------------------------------------------------------
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  email        text not null,
  full_name    text,
  phone        text,
  avatar_url   text,
  -- Soft account disable. Independent of Supabase's own ban mechanism so the
  -- app can present a clear "account disabled" state.
  is_active    boolean not null default true,
  last_seen_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint profiles_email_not_blank check (length(trim(email)) > 0)
);

create unique index profiles_email_lower_key on public.profiles (lower(email));

comment on table public.profiles is
  'One row per authenticated user. Populated automatically by the auth.users trigger in migration 0011.';

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function app.set_updated_at();

alter table public.profiles enable row level security;

-- ---------------------------------------------------------------------------
-- platform_admins — product owner / support staff
-- ---------------------------------------------------------------------------
-- Deliberately a table rather than a claim or a hard-coded email list: platform
-- authority must be revocable from the database and auditable.
create table public.platform_admins (
  user_id    uuid primary key references public.profiles (id) on delete cascade,
  role       public.platform_role not null default 'SUPER_ADMIN',
  is_active  boolean not null default true,
  notes      text,
  granted_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.platform_admins is
  'Platform-level (cross-tenant) operators. Membership here is what app.is_platform_admin() checks.';

create index platform_admins_active_idx on public.platform_admins (user_id) where is_active;

create trigger platform_admins_set_updated_at
  before update on public.platform_admins
  for each row execute function app.set_updated_at();

alter table public.platform_admins enable row level security;

-- ---------------------------------------------------------------------------
-- tenants — one physical club
-- ---------------------------------------------------------------------------
-- Every column on this table is PLATFORM CONTROLLED. Tenant users may read
-- their own row (the app needs the branding to theme itself) but migration 0009
-- deliberately declares no INSERT/UPDATE/DELETE policy for them, so club staff
-- cannot alter branding, currency, timezone or status by any route.
create table public.tenants (
  id                   uuid primary key default gen_random_uuid(),
  slug                 text not null,
  name                 text not null,
  legal_name           text,
  status               public.tenant_status not null default 'TRIAL',

  -- Branding (platform controlled)
  logo_url             text,
  primary_color        text not null default '#059669',
  secondary_color      text,
  -- Optional named preset ('emerald', 'midnight', ...) resolved by the app's
  -- theme registry. `primary_color` still wins when both are present.
  theme_preset         text,

  -- Locale / money
  currency_code        char(3) not null default 'INR',
  currency_minor_units smallint not null default 2,
  timezone             text not null default 'Asia/Kolkata',
  -- Clubs that trade past midnight: 04:00 means 01:30 local belongs to the
  -- previous business day.
  business_day_cutoff  time not null default '00:00',

  -- Contact
  contact_name         text,
  contact_email        text,
  contact_phone        text,
  address_line1        text,
  address_line2        text,
  city                 text,
  state                text,
  postal_code          text,
  country_code         char(2) not null default 'IN',

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  constraint tenants_slug_format   check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) between 3 and 63),
  constraint tenants_name_not_blank check (length(trim(name)) > 0),
  constraint tenants_primary_color_hex   check (app.is_hex_color(primary_color)),
  constraint tenants_secondary_color_hex check (secondary_color is null or app.is_hex_color(secondary_color)),
  constraint tenants_currency_format     check (currency_code ~ '^[A-Z]{3}$'),
  constraint tenants_currency_minor      check (currency_minor_units between 0 and 4),
  constraint tenants_timezone_valid      check (app.is_valid_timezone(timezone)),
  constraint tenants_country_format      check (country_code ~ '^[A-Z]{2}$'),
  constraint tenants_contact_email_format
    check (contact_email is null or contact_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
);

create unique index tenants_slug_key on public.tenants (lower(slug));
create index tenants_status_idx on public.tenants (status);

comment on table public.tenants is
  'One club. All columns are platform-controlled; tenant users have read-only visibility of their own row.';
comment on column public.tenants.primary_color is
  'Brand colour driving the app theme. Semantic success/warning/error colours are never derived from it.';

create trigger tenants_set_updated_at
  before update on public.tenants
  for each row execute function app.set_updated_at();

alter table public.tenants enable row level security;

-- ---------------------------------------------------------------------------
-- tenant_memberships — which user belongs to which club, and as what
-- ---------------------------------------------------------------------------
-- Modelled many-to-many from day one. The product currently assumes one active
-- membership per user, which is enforced by a *partial unique index* that can
-- simply be dropped when multi-club staff become a requirement.
create table public.tenant_memberships (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  role       public.tenant_role not null,
  status     public.membership_status not null default 'ACTIVE',
  invited_by uuid references public.profiles (id) on delete set null,
  invited_at timestamptz,
  joined_at  timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint tenant_memberships_unique_user_tenant unique (tenant_id, user_id)
);

-- Today's product rule: a user works at exactly one club at a time.
-- Drop this index (and only this index) to enable multi-club staff.
create unique index tenant_memberships_single_active_per_user
  on public.tenant_memberships (user_id)
  where status = 'ACTIVE';

create index tenant_memberships_tenant_idx on public.tenant_memberships (tenant_id, status);
create index tenant_memberships_user_idx   on public.tenant_memberships (user_id, status);

comment on table public.tenant_memberships is
  'Authoritative source of tenant identity. The client never supplies tenant_id or role - it is derived from here.';

create trigger tenant_memberships_set_updated_at
  before update on public.tenant_memberships
  for each row execute function app.set_updated_at();

alter table public.tenant_memberships enable row level security;
