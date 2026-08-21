-- ============================================================================
-- 0016 · Platform administration
-- ----------------------------------------------------------------------------
-- The platform operator manages the customer relationship: who the owners are,
-- which clubs exist, who runs them, and how each club is branded. It does not
-- manage a club's tables, pricing or stock - migration 0015 moved those to the
-- owner.
--
-- Read functions here are SECURITY INVOKER. They aggregate across tenants, and
-- RLS is what decides how far that reach goes: a platform admin sees every
-- club, a club owner calling the same function sees only their own. The
-- tenant_id arguments are never the security boundary.
--
-- Write functions are SECURITY DEFINER because `public.tenants` is not writable
-- by any client role, and each re-checks `app.is_platform_admin()` itself.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Platform overview
-- ---------------------------------------------------------------------------
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
    -- A club with no active owner cannot be configured by anybody, so the
    -- platform screen surfaces it as something needing attention.
    (select count(*)::integer
       from public.tenants t
      where not exists (
        select 1 from public.tenant_memberships m
         where m.tenant_id = t.id and m.role = 'OWNER' and m.status = 'ACTIVE'
      ));
$$;

comment on function public.platform_overview() is
  'Counts for the platform dashboard. SECURITY INVOKER: RLS decides how much of the platform the caller can see.';

-- ---------------------------------------------------------------------------
-- Owner directory
-- ---------------------------------------------------------------------------
-- One row per person holding an OWNER membership anywhere, with how many clubs
-- they run. This is what makes "owner" a first-class idea in the UI without
-- adding an owners table - ownership is a membership, not a separate entity.
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
  where m.role = 'OWNER' and m.status = 'ACTIVE'
  group by p.id, p.email, p.full_name, p.phone, p.is_active
  order by p.full_name nulls last, p.email;
$$;

-- Clubs run by one owner, for the owner-detail screen.
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
  order by t.name;
$$;

-- Every club with its owner attached, for the platform club list.
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
  order by t.name;
$$;

-- ---------------------------------------------------------------------------
-- Creating a club under an owner
-- ---------------------------------------------------------------------------
-- The one call the platform "create club" form makes. It provisions the club,
-- attaches the owner and writes the audit entry in a single transaction, so a
-- club can never exist in the half-made state of having no owner.
--
-- The owner must already have a Supabase Auth account. Creating credentials
-- requires the service role, which never reaches the mobile app, so account
-- creation stays a dashboard/Admin-API step - see docs/operations.md.
create or replace function public.platform_create_club(
  p_name             text,
  p_slug             text,
  p_owner_email      text,
  p_primary_color    text default '#059669',
  p_secondary_color  text default null,
  p_theme_preset     text default null,
  p_logo_url         text default null,
  p_currency_code    char(3) default 'INR',
  p_timezone         text default 'Asia/Kolkata',
  p_status           public.tenant_status default 'TRIAL',
  p_contact_name     text default null,
  p_contact_email    text default null,
  p_contact_phone    text default null,
  p_address_line1    text default null,
  p_city             text default null,
  p_state            text default null
)
returns public.tenants
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant   public.tenants;
  v_owner_id uuid;
begin
  if not app.is_platform_admin() then
    raise exception 'only platform administrators may create clubs'
      using errcode = '42501';
  end if;

  select p.id into v_owner_id
    from public.profiles p
   where lower(p.email) = lower(trim(p_owner_email));

  if v_owner_id is null then
    raise exception 'no account exists for %', p_owner_email
      using errcode = 'P0002',
            hint = 'Create the account in Supabase Auth first, then create the club.';
  end if;

  insert into public.tenants (
    name, slug, primary_color, secondary_color, theme_preset, logo_url,
    currency_code, timezone, status,
    contact_name, contact_email, contact_phone, address_line1, city, state
  )
  values (
    p_name, p_slug, p_primary_color, p_secondary_color, p_theme_preset, p_logo_url,
    p_currency_code, p_timezone, p_status,
    p_contact_name, p_contact_email, p_contact_phone, p_address_line1, p_city, p_state
  )
  returning * into v_tenant;
  -- The AFTER INSERT trigger has already seeded billing settings, the three
  -- default table types and the default categories at this point.

  insert into public.tenant_memberships
    (tenant_id, user_id, role, status, invited_by, invited_at, joined_at)
  values (v_tenant.id, v_owner_id, 'OWNER', 'ACTIVE', (select auth.uid()), now(), now())
  on conflict (tenant_id, user_id)
    do update set role = 'OWNER', status = 'ACTIVE', updated_at = now();

  insert into public.activity_logs
    (tenant_id, actor_user_id, actor_role, action, entity_type, entity_id, summary, metadata)
  values (
    v_tenant.id, (select auth.uid()), 'PLATFORM_SUPER_ADMIN', 'club.created',
    'tenant', v_tenant.id,
    format('Club %s created for %s', v_tenant.name, p_owner_email),
    jsonb_build_object('owner_user_id', v_owner_id, 'owner_email', p_owner_email)
  );

  return v_tenant;
end;
$$;

comment on function public.platform_create_club is
  'Platform-only. Creates a club, attaches its owner and audits it in one transaction.';

-- Move a club to a different owner, or attach one to a club that has none.
create or replace function public.platform_assign_owner(
  p_tenant_id   uuid,
  p_owner_email text,
  p_replace_existing boolean default true
)
returns public.tenant_memberships
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id   uuid;
  v_membership public.tenant_memberships;
begin
  if not app.is_platform_admin() then
    raise exception 'only platform administrators may assign club owners'
      using errcode = '42501';
  end if;

  select p.id into v_owner_id
    from public.profiles p
   where lower(p.email) = lower(trim(p_owner_email));

  if v_owner_id is null then
    raise exception 'no account exists for %', p_owner_email
      using errcode = 'P0002',
            hint = 'Create the account in Supabase Auth first.';
  end if;

  if p_replace_existing then
    update public.tenant_memberships
       set status = 'DISABLED', updated_at = now()
     where tenant_id = p_tenant_id
       and role = 'OWNER'
       and status = 'ACTIVE'
       and user_id <> v_owner_id;
  end if;

  insert into public.tenant_memberships
    (tenant_id, user_id, role, status, invited_by, invited_at, joined_at)
  values (p_tenant_id, v_owner_id, 'OWNER', 'ACTIVE', (select auth.uid()), now(), now())
  on conflict (tenant_id, user_id)
    do update set role = 'OWNER', status = 'ACTIVE', updated_at = now()
  returning * into v_membership;

  insert into public.activity_logs
    (tenant_id, actor_user_id, actor_role, action, entity_type, entity_id, summary)
  values (p_tenant_id, (select auth.uid()), 'PLATFORM_SUPER_ADMIN', 'club.owner_assigned',
          'tenant_membership', v_membership.id,
          format('%s assigned as owner', p_owner_email));

  return v_membership;
end;
$$;

-- Suspend or restore an owner across every club they run.
create or replace function public.platform_set_owner_active(
  p_owner_user_id uuid,
  p_is_active     boolean
)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles;
begin
  if not app.is_platform_admin() then
    raise exception 'only platform administrators may change account status'
      using errcode = '42501';
  end if;

  update public.profiles set is_active = p_is_active
   where id = p_owner_user_id
  returning * into v_profile;

  if v_profile.id is null then
    raise exception 'no profile % found', p_owner_user_id using errcode = 'P0002';
  end if;

  insert into public.activity_logs
    (tenant_id, actor_user_id, actor_role, action, entity_type, entity_id, summary)
  values (null, (select auth.uid()), 'PLATFORM_SUPER_ADMIN',
          case when p_is_active then 'owner.enabled' else 'owner.disabled' end,
          'profile', p_owner_user_id,
          format('%s %s', v_profile.email, case when p_is_active then 'enabled' else 'disabled' end));

  return v_profile;
end;
$$;

-- ---------------------------------------------------------------------------
-- Branding: replace the 0010 version with one that reaches the address fields
-- ---------------------------------------------------------------------------
drop function if exists public.platform_update_tenant(
  uuid, text, text, text, text, text, char, text, text, text, text);

create or replace function public.platform_update_tenant(
  p_tenant_id       uuid,
  p_name            text default null,
  p_logo_url        text default null,
  p_primary_color   text default null,
  p_secondary_color text default null,
  p_theme_preset    text default null,
  p_currency_code   char(3) default null,
  p_timezone        text default null,
  p_contact_name    text default null,
  p_contact_email   text default null,
  p_contact_phone   text default null,
  p_address_line1   text default null,
  p_city            text default null,
  p_state           text default null,
  -- Coalesce semantics mean NULL is "leave alone", so clearing a logo needs an
  -- explicit flag rather than a magic value.
  p_clear_logo      boolean default false
)
returns public.tenants
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant public.tenants;
begin
  if not app.is_platform_admin() then
    raise exception 'only platform administrators may change club configuration'
      using errcode = '42501';
  end if;

  update public.tenants t
     set name            = coalesce(p_name, t.name),
         logo_url        = case when p_clear_logo then null else coalesce(p_logo_url, t.logo_url) end,
         primary_color   = coalesce(p_primary_color, t.primary_color),
         secondary_color = coalesce(p_secondary_color, t.secondary_color),
         theme_preset    = coalesce(p_theme_preset, t.theme_preset),
         currency_code   = coalesce(p_currency_code, t.currency_code),
         timezone        = coalesce(p_timezone, t.timezone),
         contact_name    = coalesce(p_contact_name, t.contact_name),
         contact_email   = coalesce(p_contact_email, t.contact_email),
         contact_phone   = coalesce(p_contact_phone, t.contact_phone),
         address_line1   = coalesce(p_address_line1, t.address_line1),
         city            = coalesce(p_city, t.city),
         state           = coalesce(p_state, t.state)
   where t.id = p_tenant_id
  returning * into v_tenant;

  if v_tenant.id is null then
    raise exception 'tenant % not found', p_tenant_id using errcode = 'P0002';
  end if;

  insert into public.activity_logs
    (tenant_id, actor_user_id, actor_role, action, entity_type, entity_id, summary)
  values (p_tenant_id, (select auth.uid()), 'PLATFORM_SUPER_ADMIN', 'club.updated',
          'tenant', p_tenant_id, format('Configuration updated for %s', v_tenant.name));

  return v_tenant;
end;
$$;

comment on function public.platform_update_tenant is
  'Platform-only. The single write path for club branding and configuration; public.tenants is not writable by clients.';

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
grant execute on function public.platform_overview()                    to authenticated;
grant execute on function public.platform_owners()                      to authenticated;
grant execute on function public.platform_owner_clubs(uuid)             to authenticated;
grant execute on function public.platform_clubs()                       to authenticated;
grant execute on function public.platform_set_owner_active(uuid, boolean) to authenticated;
grant execute on function public.platform_assign_owner(uuid, text, boolean) to authenticated;
grant execute on function public.platform_create_club(
  text, text, text, text, text, text, text, char, text, public.tenant_status,
  text, text, text, text, text, text) to authenticated;
grant execute on function public.platform_update_tenant(
  uuid, text, text, text, text, text, char, text, text, text, text, text, text, text, boolean)
  to authenticated;
