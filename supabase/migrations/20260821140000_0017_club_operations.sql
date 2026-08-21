-- ============================================================================
-- 0017 · Club operations: staff, audit trail, and the end of the single-club
--        assumption in application-facing helpers
-- ============================================================================
-- Migration 0015 removed the *physical* barrier to one owner running several
-- clubs. This one removes the remaining *semantic* ones: helpers and RPCs that
-- were written when "the caller's club" was a well-defined phrase.

-- ---------------------------------------------------------------------------
-- app.get_user_tenant_id — no longer answerable in general
-- ---------------------------------------------------------------------------
-- An owner may now reach several clubs, so "the caller's tenant" has no answer
-- for them. Rather than keep silently returning whichever row came back first -
-- which would attribute an owner's action to an arbitrary one of their clubs -
-- this now returns NULL whenever the question is ambiguous.
--
-- Nothing in the RLS policy set uses it; it exists for the client wrapper and
-- for tests. New code should ask for `app.tenant_ids()` and let the caller
-- choose.
create or replace function app.get_user_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select case when count(*) = 1 then (array_agg(tid))[1] end
  from app.tenant_ids() as tid;
$$;

comment on function app.get_user_tenant_id() is
  'Deprecated. Returns the caller''s tenant only when they have exactly one; NULL otherwise. Use app.tenant_ids().';

comment on function public.get_user_tenant_id() is
  'Deprecated. NULL for a multi-club owner - the client must select an active club explicitly.';

-- ---------------------------------------------------------------------------
-- public.log_activity — one way in to the audit trail
-- ---------------------------------------------------------------------------
-- SECURITY INVOKER on purpose. The insert policy on activity_logs already
-- requires `actor_user_id = auth.uid()` and membership of the tenant being
-- written about, so this function cannot be used to forge an entry - and
-- because it runs as the caller, it inherits exactly those checks rather than
-- re-implementing them.
--
-- `actor_role` is resolved here rather than accepted from the client: it is the
-- field a reader uses to judge "should this person have been able to do that",
-- and a client-supplied answer would be worthless.
create or replace function public.log_activity(
  p_action      text,
  p_tenant_id   uuid default null,
  p_entity_type text default null,
  p_entity_id   uuid default null,
  p_summary     text default null,
  p_metadata    jsonb default '{}'::jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_role text;
begin
  if p_tenant_id is null then
    v_role := case when app.is_platform_admin() then 'PLATFORM' end;
  else
    select m.role::text into v_role
      from public.tenant_memberships m
     where m.tenant_id = p_tenant_id
       and m.user_id = (select auth.uid())
       and m.status = 'ACTIVE';

    if v_role is null and app.is_platform_admin() then
      v_role := 'PLATFORM';
    end if;
  end if;

  -- No RETURNING. `activity_logs` is readable only by the club's owner and the
  -- platform, and RETURNING re-applies the SELECT policy - so echoing the row
  -- back would make this function fail for the receptionists who generate most
  -- of the entries. The trail is deliberately write-only for the people being
  -- audited.
  insert into public.activity_logs
    (tenant_id, actor_user_id, actor_role, action, entity_type, entity_id, summary, metadata)
  values
    (p_tenant_id, (select auth.uid()), v_role, p_action, p_entity_type, p_entity_id,
     p_summary, coalesce(p_metadata, '{}'::jsonb));
end;
$$;

comment on function public.log_activity(text, uuid, text, uuid, text, jsonb) is
  'Append one audit entry as the calling user. SECURITY INVOKER: RLS decides whether the write is allowed. Returns nothing - the trail is not readable by everyone who may write to it.';

-- ---------------------------------------------------------------------------
-- public.tenant_activity — the club's recent history, for owners
-- ---------------------------------------------------------------------------
-- SECURITY INVOKER: the select policy on activity_logs already limits reads to
-- `app.can_manage_tenant(tenant_id)`, so a receptionist calling this simply
-- receives nothing.
create or replace function public.tenant_activity(
  p_tenant_id uuid,
  p_limit     integer default 50
)
returns table (
  id            bigint,
  action        text,
  entity_type   text,
  entity_id     uuid,
  summary       text,
  metadata      jsonb,
  actor_role    text,
  actor_name    text,
  actor_email   text,
  created_at    timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    a.id,
    a.action,
    a.entity_type,
    a.entity_id,
    a.summary,
    a.metadata,
    a.actor_role,
    p.full_name,
    p.email,
    a.created_at
  from public.activity_logs a
  left join public.profiles p on p.id = a.actor_user_id
  where a.tenant_id = p_tenant_id
  order by a.created_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 200));
$$;

comment on function public.tenant_activity(uuid, integer) is
  'Recent audit entries for one club. Readable by that club''s owner and the platform.';

-- ---------------------------------------------------------------------------
-- public.tenant_staff — who works at this club
-- ---------------------------------------------------------------------------
-- SECURITY INVOKER again: `tenant_memberships` is readable by any member of the
-- club, and `profiles` by anyone sharing a club, so this composes two reads the
-- caller could already perform - it just returns them in one shape.
create or replace function public.tenant_staff(p_tenant_id uuid)
returns table (
  membership_id uuid,
  user_id       uuid,
  email         text,
  full_name     text,
  phone         text,
  avatar_url    text,
  role          public.tenant_role,
  status        public.membership_status,
  account_active boolean,
  last_seen_at  timestamptz,
  joined_at     timestamptz,
  created_at    timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    m.id,
    m.user_id,
    p.email,
    p.full_name,
    p.phone,
    p.avatar_url,
    m.role,
    m.status,
    p.is_active,
    p.last_seen_at,
    m.joined_at,
    m.created_at
  from public.tenant_memberships m
  join public.profiles p on p.id = m.user_id
  where m.tenant_id = p_tenant_id
  order by
    case m.role when 'OWNER' then 0 else 1 end,
    coalesce(p.full_name, p.email);
$$;

comment on function public.tenant_staff(uuid) is
  'Staff roster for one club, including inactive memberships so an owner can reinstate someone.';

-- ---------------------------------------------------------------------------
-- add_tenant_member — an owner may hire reception, not co-owners
-- ---------------------------------------------------------------------------
-- Ownership is a platform-level commercial relationship: it decides who is
-- billed and who may configure a club. Letting a club owner mint another owner
-- would move that decision out of the platform's hands, so only the platform
-- may grant OWNER. Everything else is unchanged.
create or replace function public.add_tenant_member(
  p_tenant_id uuid,
  p_email     text,
  p_role      public.tenant_role
)
returns public.tenant_memberships
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id    uuid;
  v_membership public.tenant_memberships;
begin
  if not app.can_manage_tenant(p_tenant_id) then
    raise exception 'insufficient privileges to manage staff for this club'
      using errcode = '42501';
  end if;

  if p_role = 'OWNER' and not app.is_platform_admin() then
    raise exception 'only the platform may assign club ownership'
      using errcode = '42501',
            hint = 'Ask the platform administrator to add another owner to this club.';
  end if;

  select p.id into v_user_id
    from public.profiles p
   where lower(p.email) = lower(trim(p_email));

  if v_user_id is null then
    raise exception 'no account exists for %', p_email
      using errcode = 'P0002',
            hint = 'Create the account in Supabase Auth first, then add the membership.';
  end if;

  begin
    insert into public.tenant_memberships (tenant_id, user_id, role, status, invited_by, invited_at, joined_at)
    values (p_tenant_id, v_user_id, p_role, 'ACTIVE', (select auth.uid()), now(), now())
    on conflict (tenant_id, user_id)
      do update set role = excluded.role, status = 'ACTIVE', updated_at = now()
    returning * into v_membership;
  exception
    when unique_violation then
      -- The only other unique constraint reachable here is the partial index
      -- that pins a receptionist to one club (migration 0015). Raw constraint
      -- text is useless to an owner adding staff, so say what actually happened.
      raise exception '% already works at another club', p_email
        using errcode = '23505',
              hint = 'A receptionist can only be active at one club. Ask their current club to release them first.';
  end;

  insert into public.activity_logs (tenant_id, actor_user_id, actor_role, action, entity_type, entity_id, summary)
  values (p_tenant_id, (select auth.uid()),
          case when app.is_platform_admin() then 'PLATFORM' else 'OWNER' end,
          'membership.upserted', 'tenant_membership',
          v_membership.id, format('%s added as %s', p_email, p_role));

  return v_membership;
end;
$$;

comment on function public.add_tenant_member(uuid, text, public.tenant_role) is
  'Owner/platform-only. Links an existing account to a club. Only the platform may grant OWNER.';

-- ---------------------------------------------------------------------------
-- public.set_membership_status — suspend or reinstate a staff member
-- ---------------------------------------------------------------------------
-- Memberships are never deleted from the app: an ex-receptionist's name still
-- appears against every session they opened, and removing the row would orphan
-- that history. Deactivating revokes access - `app.tenant_ids()` only counts
-- ACTIVE memberships - while leaving the trail intact.
--
-- SECURITY DEFINER because it enforces two rules that RLS cannot express: a
-- club must not be left ownerless, and nobody may revoke their own access (an
-- owner locking themselves out would need platform intervention to undo).
create or replace function public.set_membership_status(
  p_membership_id uuid,
  p_status        public.membership_status
)
returns public.tenant_memberships
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_membership     public.tenant_memberships;
  v_remaining_owners integer;
begin
  select * into v_membership
    from public.tenant_memberships
   where id = p_membership_id;

  if v_membership.id is null then
    raise exception 'membership not found' using errcode = 'P0002';
  end if;

  if not app.can_manage_tenant(v_membership.tenant_id) then
    raise exception 'insufficient privileges to manage staff for this club'
      using errcode = '42501';
  end if;

  if v_membership.user_id = (select auth.uid()) then
    raise exception 'you cannot change your own membership'
      using errcode = '42501',
            hint = 'Ask another owner or the platform administrator.';
  end if;

  if v_membership.role = 'OWNER' and p_status <> 'ACTIVE' then
    select count(*) into v_remaining_owners
      from public.tenant_memberships m
     where m.tenant_id = v_membership.tenant_id
       and m.role = 'OWNER'
       and m.status = 'ACTIVE'
       and m.id <> v_membership.id;

    if v_remaining_owners = 0 then
      raise exception 'a club must keep at least one active owner'
        using errcode = '23514',
              hint = 'Assign another owner first.';
    end if;
  end if;

  update public.tenant_memberships
     set status = p_status,
         updated_at = now()
   where id = p_membership_id
  returning * into v_membership;

  insert into public.activity_logs
    (tenant_id, actor_user_id, actor_role, action, entity_type, entity_id, summary)
  values
    (v_membership.tenant_id, (select auth.uid()),
     case when app.is_platform_admin() then 'PLATFORM' else 'OWNER' end,
     'membership.status_changed', 'tenant_membership', v_membership.id,
     format('membership set to %s', p_status));

  return v_membership;
end;
$$;

comment on function public.set_membership_status(uuid, public.membership_status) is
  'Owner/platform-only. Revokes or restores a staff member''s access without deleting their history.';

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
grant execute on function public.log_activity(text, uuid, text, uuid, text, jsonb) to authenticated;
grant execute on function public.tenant_activity(uuid, integer)                   to authenticated;
grant execute on function public.tenant_staff(uuid)                               to authenticated;
grant execute on function public.set_membership_status(uuid, public.membership_status) to authenticated;
