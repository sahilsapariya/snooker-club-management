-- ============================================================================
-- 0018 · Platform reads say what they mean
-- ============================================================================
-- The four `platform_*` read functions are SECURITY INVOKER, so Row Level
-- Security already limits what any caller gets back. That is the security
-- boundary and it is working: a receptionist calling `platform_owners()` today
-- receives exactly one row - the owner of their own club, whose email they can
-- already read from `tenant_staff` - and never sees a club they are not in.
--
-- But a *partial* answer from a function named `platform_owners` is a bad
-- answer. It invites a caller to believe they are looking at the platform when
-- they are looking at their own club, and it invites a future reader to assume
-- these functions are already platform-gated when nothing said so.
--
-- So each one now also asks whether the caller is the platform. This is defence
-- in depth and, mostly, honesty about intent: RLS still decides what rows
-- exist, and these functions still cannot see past it.

create or replace function public.platform_overview()
returns table (
  owners_count     integer,
  clubs_count      integer,
  active_clubs     integer,
  trial_clubs      integer,
  suspended_clubs  integer,
  archived_clubs   integer,
  staff_count      integer,
  clubs_without_owner integer
)
language sql
stable
set search_path = ''
as $$
  select
    (select count(distinct m.user_id)::integer
       from public.tenant_memberships m
      where m.role = 'OWNER' and m.status = 'ACTIVE'),
    (select count(*)::integer from public.tenants),
    (select count(*)::integer from public.tenants where status = 'ACTIVE'),
    (select count(*)::integer from public.tenants where status = 'TRIAL'),
    (select count(*)::integer from public.tenants where status = 'SUSPENDED'),
    (select count(*)::integer from public.tenants where status = 'ARCHIVED'),
    (select count(distinct m.user_id)::integer
       from public.tenant_memberships m
      where m.role = 'RECEPTIONIST' and m.status = 'ACTIVE'),
    (select count(*)::integer
       from public.tenants t
      where not exists (
        select 1 from public.tenant_memberships m
         where m.tenant_id = t.id and m.role = 'OWNER' and m.status = 'ACTIVE'
      ))
  where app.is_platform_admin();
$$;

comment on function public.platform_overview() is
  'Counts for the platform dashboard. Platform-only, and SECURITY INVOKER so RLS still applies underneath.';

create or replace function public.platform_owners()
returns table (
  user_id       uuid,
  email         text,
  full_name     text,
  phone         text,
  is_active     boolean,
  clubs_count   integer,
  active_clubs  integer,
  joined_at     timestamptz
)
language sql
stable
set search_path = ''
as $$
  select
    p.id,
    p.email,
    p.full_name,
    p.phone,
    p.is_active,
    count(*)::integer,
    count(*) filter (where t.status in ('ACTIVE', 'TRIAL'))::integer,
    min(m.created_at)
  from public.tenant_memberships m
  join public.profiles p on p.id = m.user_id
  join public.tenants t on t.id = m.tenant_id
  where m.role = 'OWNER'
    and m.status = 'ACTIVE'
    and app.is_platform_admin()
  group by p.id, p.email, p.full_name, p.phone, p.is_active
  order by p.full_name nulls last, p.email;
$$;

comment on function public.platform_owners() is
  'Everyone holding an active OWNER membership anywhere, with a club count. Platform-only.';

create or replace function public.platform_owner_clubs(p_owner_user_id uuid)
returns table (
  tenant_id    uuid,
  name         text,
  slug         text,
  status       public.tenant_status,
  primary_color text,
  logo_url     text,
  currency_code char(3),
  timezone     text,
  city         text,
  created_at   timestamptz,
  staff_count  integer,
  tables_count integer
)
language sql
stable
set search_path = ''
as $$
  select
    t.id, t.name, t.slug, t.status, t.primary_color, t.logo_url,
    t.currency_code, t.timezone, t.city, t.created_at,
    (select count(*)::integer from public.tenant_memberships s
      where s.tenant_id = t.id and s.role = 'RECEPTIONIST' and s.status = 'ACTIVE'),
    (select count(*)::integer from public.club_tables ct
      where ct.tenant_id = t.id and ct.is_active)
  from public.tenant_memberships m
  join public.tenants t on t.id = m.tenant_id
  where m.user_id = p_owner_user_id
    and m.role = 'OWNER'
    and m.status = 'ACTIVE'
    and app.is_platform_admin()
  order by t.name;
$$;

comment on function public.platform_owner_clubs(uuid) is
  'Every club one owner runs. Platform-only - an owner sees their own clubs through their memberships.';

create or replace function public.platform_clubs()
returns table (
  tenant_id     uuid,
  name          text,
  slug          text,
  status        public.tenant_status,
  primary_color text,
  logo_url      text,
  currency_code char(3),
  timezone      text,
  city          text,
  created_at    timestamptz,
  owner_user_id uuid,
  owner_name    text,
  owner_email   text,
  staff_count   integer,
  tables_count  integer
)
language sql
stable
set search_path = ''
as $$
  select
    t.id, t.name, t.slug, t.status, t.primary_color, t.logo_url,
    t.currency_code, t.timezone, t.city, t.created_at,
    o.user_id, op.full_name, op.email,
    (select count(*)::integer from public.tenant_memberships s
      where s.tenant_id = t.id and s.role = 'RECEPTIONIST' and s.status = 'ACTIVE'),
    (select count(*)::integer from public.club_tables ct
      where ct.tenant_id = t.id and ct.is_active)
  from public.tenants t
  -- A club should have one active owner, but the join is lateral-and-limited so
  -- a data anomaly renders as "first owner" rather than duplicating the club.
  left join lateral (
    select m.user_id
    from public.tenant_memberships m
    where m.tenant_id = t.id and m.role = 'OWNER' and m.status = 'ACTIVE'
    order by m.created_at
    limit 1
  ) o on true
  left join public.profiles op on op.id = o.user_id
  where app.is_platform_admin()
  order by t.name;
$$;

comment on function public.platform_clubs() is
  'Every club with its owner attached. Platform-only.';
