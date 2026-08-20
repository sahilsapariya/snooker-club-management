-- ============================================================================
-- 0003 · Authorization helpers
-- ----------------------------------------------------------------------------
-- Every RLS policy in this project is expressed in terms of these functions.
--
-- All of them are:
--   * SECURITY DEFINER — they read platform_admins / tenant_memberships, both of
--     which are themselves RLS-protected. Without SECURITY DEFINER a policy that
--     consults membership would recurse into the very table it is protecting.
--   * STABLE           — one evaluation per statement; Postgres can hoist them
--                        into an InitPlan instead of re-running them per row.
--   * search_path = '' — fully-qualified names only, so a hostile search_path
--                        cannot shadow a table or operator inside a definer
--                        function.
--   * living in `app`  — not exposed through PostgREST, so no client can call
--                        them with a forged argument to probe the system.
--
-- Client code NEVER supplies a tenant_id or a role. Tenant identity is derived
-- here, from the authenticated user's membership rows.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Platform level
-- ---------------------------------------------------------------------------
create or replace function app.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.platform_admins pa
    where pa.user_id = (select auth.uid())
      and pa.is_active
  );
$$;

comment on function app.is_platform_admin() is
  'True when the caller holds an active row in public.platform_admins.';

create or replace function app.has_platform_role(p_role public.platform_role)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.platform_admins pa
    where pa.user_id = (select auth.uid())
      and pa.is_active
      and pa.role = p_role
  );
$$;

-- ---------------------------------------------------------------------------
-- Tenant level
-- ---------------------------------------------------------------------------

-- Every tenant the caller actively belongs to, restricted to tenants that are
-- not suspended/archived. Suspension therefore revokes data access instantly
-- without touching membership rows.
create or replace function app.tenant_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.tenant_id
  from public.tenant_memberships m
  join public.tenants t on t.id = m.tenant_id
  join public.profiles p on p.id = m.user_id
  where m.user_id = (select auth.uid())
    and m.status = 'ACTIVE'
    and p.is_active
    and t.status in ('TRIAL', 'ACTIVE');
$$;

-- The caller's single tenant. Returns NULL when the user has no usable
-- membership (which the app surfaces as the "no tenant assigned" state).
create or replace function app.get_user_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select tid from app.tenant_ids() as tid limit 1;
$$;

create or replace function app.is_tenant_member(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_tenant_id is not null
     and exists (select 1 from app.tenant_ids() as tid where tid = p_tenant_id);
$$;

create or replace function app.has_tenant_role(p_tenant_id uuid, variadic p_roles public.tenant_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_tenant_id is not null
     and exists (
       select 1
       from public.tenant_memberships m
       join public.tenants t on t.id = m.tenant_id
       join public.profiles pr on pr.id = m.user_id
       where m.user_id = (select auth.uid())
         and m.tenant_id = p_tenant_id
         and m.status = 'ACTIVE'
         and pr.is_active
         and t.status in ('TRIAL', 'ACTIVE')
         and m.role = any (p_roles)
     );
$$;

-- ---------------------------------------------------------------------------
-- Capability predicates — what policies actually reference
-- ---------------------------------------------------------------------------

-- Read access to a tenant's data: any active member, or a platform operator.
create or replace function app.can_read_tenant(p_tenant_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select app.is_platform_admin() or app.is_tenant_member(p_tenant_id);
$$;

-- Day-to-day operational writes: start/close sessions, sell products, record
-- expenses and cash. Owner and receptionist. Platform operators are read-only
-- on transactional data by design.
create or replace function app.can_operate_tenant(p_tenant_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select app.has_tenant_role(p_tenant_id, 'OWNER', 'RECEPTIONIST');
$$;

-- Club configuration writes: tables, pricing, products, staff, billing rules.
-- Owner, or a platform operator acting on the club's behalf.
create or replace function app.can_manage_tenant(p_tenant_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select app.is_platform_admin() or app.has_tenant_role(p_tenant_id, 'OWNER');
$$;

-- Owner only, no platform escalation. Used where a platform operator should not
-- be able to silently mutate a club's books.
create or replace function app.is_tenant_owner(p_tenant_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select app.has_tenant_role(p_tenant_id, 'OWNER');
$$;

-- Do the caller and `p_user_id` work at the same club? Drives profile
-- visibility so staff can see who started a session without exposing the whole
-- user table.
create or replace function app.shares_tenant_with(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.tenant_memberships peer
    where peer.user_id = p_user_id
      and peer.status = 'ACTIVE'
      and peer.tenant_id in (select tid from app.tenant_ids() as tid)
  );
$$;

-- ---------------------------------------------------------------------------
-- Public, client-callable wrappers
-- ---------------------------------------------------------------------------
-- Thin, side-effect-free views onto the helpers above. They exist so the mobile
-- client can render the right shell without guessing, but they are advisory
-- only: the RLS policies remain the enforcement point.
create or replace function public.is_platform_admin()
returns boolean
language sql
stable
set search_path = ''
as $$ select app.is_platform_admin(); $$;

create or replace function public.get_user_tenant_id()
returns uuid
language sql
stable
set search_path = ''
as $$ select app.get_user_tenant_id(); $$;

comment on function public.is_platform_admin() is
  'Convenience RPC for the client shell. Authorization is still enforced by RLS, never by this result.';

-- Membership check that ignores tenant status. Used only by the `tenants`
-- SELECT policy, so a suspended club can still load its own name and branding
-- in order to render an "account suspended" screen. Every other policy uses the
-- status-aware helpers above.
create or replace function app.has_tenant_membership(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.tenant_memberships m
    where m.user_id = (select auth.uid())
      and m.tenant_id = p_tenant_id
      and m.status = 'ACTIVE'
  );
$$;
