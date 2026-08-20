-- ============================================================================
-- 0001 · Foundation
-- ----------------------------------------------------------------------------
-- Schemas, enumerated domains and small immutable helpers shared by the rest
-- of the schema.
--
-- Conventions used across every migration in this project:
--   * Money is stored as INTEGER MINOR UNITS in `bigint` columns suffixed
--     `_minor` (e.g. 12550 = 125.50 INR). Never floating point. See
--     docs/database.md for the rationale.
--   * Every timestamp is `timestamptz` and therefore stored in UTC. Business
--     day boundaries are derived from the tenant's timezone + cutoff.
--   * Internal helpers live in the `app` schema, which is deliberately NOT
--     exposed through PostgREST. Only `public` is reachable from the client.
-- ============================================================================

create schema if not exists app;
comment on schema app is
  'Internal helpers (authorization, triggers, provisioning). Not exposed via PostgREST.';

-- ---------------------------------------------------------------------------
-- Identity & access
-- ---------------------------------------------------------------------------
create type public.platform_role as enum ('SUPER_ADMIN', 'SUPPORT');
comment on type public.platform_role is
  'Platform (product owner) level roles. Completely separate from tenant roles.';

create type public.tenant_role as enum ('OWNER', 'RECEPTIONIST');
comment on type public.tenant_role is
  'Role a user holds inside one tenant (club). Extend with ALTER TYPE ... ADD VALUE.';

create type public.membership_status as enum ('INVITED', 'ACTIVE', 'DISABLED');

create type public.tenant_status as enum ('TRIAL', 'ACTIVE', 'SUSPENDED', 'ARCHIVED');

-- ---------------------------------------------------------------------------
-- Club operations
-- ---------------------------------------------------------------------------
create type public.club_table_status as enum ('AVAILABLE', 'MAINTENANCE', 'OUT_OF_SERVICE');
comment on type public.club_table_status is
  'Physical availability of a table. Occupancy is NOT stored here - it is derived '
  'from the presence of an open session (see public.v_club_table_overview).';

-- ACTIVE and TIME_COMPLETED are both *open* states. A session never ends on its
-- own: reaching the configured time only moves it to TIME_COMPLETED so staff can
-- be alerted. Only an explicit close sets `ended_at` and moves it to CLOSED.
create type public.session_status as enum ('ACTIVE', 'TIME_COMPLETED', 'CLOSED', 'CANCELLED');

create type public.payment_status as enum ('UNPAID', 'PARTIALLY_PAID', 'PAID', 'WAIVED');

create type public.payment_method as enum ('CASH', 'UPI', 'CARD', 'BANK_TRANSFER', 'WALLET', 'OTHER');

-- ---------------------------------------------------------------------------
-- Billing configuration
-- ---------------------------------------------------------------------------
create type public.time_calculation_mode as enum (
  'PER_MINUTE',       -- charge exactly per elapsed minute
  'PER_HOUR',         -- pro-rated hourly rate
  'FIXED_INCREMENT',  -- charge in blocks of `billing_increment_minutes`
  'CUSTOM_SLABS'      -- slab table stored in tenant_billing_settings.custom_slabs
);

create type public.rounding_mode as enum ('EXACT', 'ROUND_UP', 'ROUND_DOWN', 'NEAREST');

create type public.overtime_mode as enum (
  'SAME_RATE',        -- overtime continues at the normal rate
  'OVERTIME_RATE',    -- overtime uses tenant_billing_settings.overtime_rate_minor
  'INCREMENT_BLOCK',  -- overtime is charged in whole blocks
  'FREE'              -- overtime is not charged at all
);

create type public.pricing_mode as enum (
  'PER_MINUTE',
  'PER_HOUR',
  'FIXED_INCREMENT',
  'PER_FRAME',
  'FLAT_SESSION'
);

-- ---------------------------------------------------------------------------
-- Inventory & equipment
-- ---------------------------------------------------------------------------
create type public.inventory_movement_type as enum (
  'OPENING_BALANCE',
  'PURCHASE',
  'SALE',
  'RETURN',
  'DAMAGE',
  'ADJUSTMENT',
  'CORRECTION'
);

create type public.equipment_category as enum (
  'CUE', 'REST_CUE', 'BALL_SET', 'CHALK', 'GLOVE', 'TABLE_ACCESSORY', 'FURNITURE', 'OTHER'
);

create type public.equipment_status as enum (
  'AVAILABLE', 'IN_USE', 'NEEDS_REPAIR', 'DAMAGED', 'RETIRED'
);

-- ---------------------------------------------------------------------------
-- Cash & communications
-- ---------------------------------------------------------------------------
create type public.cash_closing_status as enum ('OPEN', 'CLOSED');

create type public.notification_type as enum (
  'SESSION_STARTED',
  'SESSION_TIME_COMPLETED',
  'SESSION_CLOSED',
  'PAYMENT_RECEIVED',
  'LOW_STOCK',
  'CASH_CLOSING_REMINDER',
  'SYSTEM_ALERT'
);

create type public.device_platform as enum ('IOS', 'ANDROID', 'WEB');

-- ---------------------------------------------------------------------------
-- Shared immutable helpers
-- ---------------------------------------------------------------------------

-- `updated_at` maintenance. Attached to every mutable table.
create or replace function app.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Guards the branding colour columns. Accepts #RGB / #RRGGBB (case-insensitive).
create or replace function app.is_hex_color(p_value text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_value ~* '^#([0-9a-f]{3}|[0-9a-f]{6})$';
$$;

-- True when `p_timezone` is a timezone name Postgres understands.
create or replace function app.is_valid_timezone(p_timezone text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
begin
  perform pg_catalog.timezone(p_timezone, timestamptz '2000-01-01 00:00:00+00');
  return true;
exception
  when others then
    return false;
end;
$$;

-- Business day for an instant, in a tenant's local time, honouring clubs that
-- trade past midnight (cutoff 04:00 => 01:30 local belongs to the previous day).
create or replace function app.business_date(
  p_at timestamptz,
  p_timezone text,
  p_cutoff time
)
returns date
language sql
immutable
set search_path = ''
as $$
  select ((pg_catalog.timezone(p_timezone, p_at)) - make_interval(hours => extract(hour from p_cutoff)::int,
                                                                 mins  => extract(minute from p_cutoff)::int))::date;
$$;

comment on function app.business_date(timestamptz, text, time) is
  'Maps a UTC instant onto the tenant-local business date, shifted by the club''s trading-day cutoff.';
