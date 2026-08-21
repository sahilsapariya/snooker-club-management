-- ============================================================================
-- 0020 · The push queue
-- ============================================================================
-- `public.notifications` becomes the queue as well as the inbox. There is no
-- second table, because a separate outbox would need the same rows, the same
-- tenant scoping and the same lifetime - and would then be able to disagree
-- with the inbox about what was sent.
--
-- Everything here is for a trusted server-side worker holding the service role.
-- The mobile app never touches any of it, and cannot: the readers and writers
-- below are granted to `service_role` alone.

alter table public.notifications
  add column if not exists pushed_at     timestamptz,
  add column if not exists push_attempts smallint not null default 0,
  add column if not exists push_error    text;

comment on column public.notifications.pushed_at is
  'When the delivery worker handed this to Expo. NULL means still queued.';
comment on column public.notifications.push_attempts is
  'Incremented on every attempt, successful or not, so a permanently failing row cannot spin forever.';

create index if not exists notifications_pending_push_idx
  on public.notifications (created_at)
  where pushed_at is null;

-- ---------------------------------------------------------------------------
-- The guard has to cover the new columns
-- ---------------------------------------------------------------------------
-- The update policy lets a recipient mark a notification read, and the guard is
-- what stops that becoming a licence to rewrite the message. Without adding the
-- push columns to it, a client could set `pushed_at` on their own alerts and
-- silently suppress delivery to everybody else on the broadcast.
create or replace function app.notifications_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or app.can_manage_tenant(old.tenant_id) then
    return new;
  end if;

  if row(new.tenant_id, new.recipient_user_id, new.type, new.title, new.body, new.metadata,
         new.entity_type, new.entity_id, new.created_at,
         new.pushed_at, new.push_attempts, new.push_error)
     is distinct from
     row(old.tenant_id, old.recipient_user_id, old.type, old.title, old.body, old.metadata,
         old.entity_type, old.entity_id, old.created_at,
         old.pushed_at, old.push_attempts, old.push_error) then
    raise exception 'only the read state of a notification may be changed'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- public.notifications_pending_push — what to send, and where
-- ---------------------------------------------------------------------------
-- The recipient set is resolved here rather than in the worker, because it is a
-- question about memberships and only the database can answer it correctly.
--
-- Note what devices are found by: `user_id`, never `device_push_tokens.tenant_id`.
-- That column records the club a device was last used in and is re-pointed on
-- every club switch. Filtering by it would silently stop delivering to an owner
-- for every club they are not currently looking at - which, for someone running
-- four clubs, is three of them.
create or replace function public.notifications_pending_push(
  p_limit       integer default 100,
  p_max_age     interval default '1 hour',
  p_max_attempts smallint default 3
)
returns table (
  notification_id uuid,
  tenant_id       uuid,
  type            public.notification_type,
  title           text,
  body            text,
  entity_type     text,
  entity_id       uuid,
  metadata        jsonb,
  created_at      timestamptz,
  tokens          text[]
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    n.id, n.tenant_id, n.type, n.title, n.body, n.entity_type, n.entity_id,
    n.metadata, n.created_at,
    array_agg(distinct d.expo_push_token)
  from public.notifications n
  join public.tenants t on t.id = n.tenant_id
  -- Recipients: the user named, or every active member when it is a broadcast.
  join public.tenant_memberships m
    on m.tenant_id = n.tenant_id
   and m.status = 'ACTIVE'
   and (n.recipient_user_id is null or m.user_id = n.recipient_user_id)
  join public.profiles p on p.id = m.user_id and p.is_active
  join public.device_push_tokens d on d.user_id = m.user_id and d.is_active
  where n.pushed_at is null
    and n.push_attempts < p_max_attempts
    -- A club that has been suspended stops receiving alerts at the same instant
    -- its staff stop being able to sign in.
    and t.status in ('TRIAL', 'ACTIVE')
    -- Already seen in the app; a push would be noise.
    and n.read_at is null
    -- A worker outage must not dump a day of stale alerts onto a phone at 3am.
    and n.created_at > now() - p_max_age
  group by n.id, n.tenant_id, n.type, n.title, n.body, n.entity_type, n.entity_id,
           n.metadata, n.created_at
  order by n.created_at
  limit greatest(1, least(coalesce(p_limit, 100), 500));
$$;

comment on function public.notifications_pending_push(integer, interval, smallint) is
  'Service-role only. Queued notifications with their recipients'' device tokens, resolved through memberships.';

-- ---------------------------------------------------------------------------
-- public.mark_notifications_pushed
-- ---------------------------------------------------------------------------
-- Attempts are counted whether or not the send worked, so a row that Expo keeps
-- rejecting stops being retried instead of spinning forever. `pushed_at` is set
-- only on success, so the difference between "sent" and "given up on" stays
-- legible in the table rather than needing a log.
create or replace function public.mark_notifications_pushed(
  p_ids     uuid[],
  p_success boolean default true,
  p_error   text default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.notifications
     set pushed_at     = case when p_success then now() else pushed_at end,
         push_attempts = push_attempts + 1,
         push_error    = case when p_success then null else p_error end
   where id = any(p_ids);

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.mark_notifications_pushed(uuid[], boolean, text) is
  'Service-role only. Records a delivery attempt. Counts attempts either way; sets pushed_at only on success.';

-- ---------------------------------------------------------------------------
-- public.deactivate_push_tokens
-- ---------------------------------------------------------------------------
-- Expo reports a dead token as `DeviceNotRegistered`, and receipts are the only
-- reliable way to learn it. Deactivated, never deleted: the row records which
-- device a person used and when, and deleting it would lose that.
create or replace function public.deactivate_push_tokens(p_tokens text[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.device_push_tokens
     set is_active = false, updated_at = now()
   where expo_push_token = any(p_tokens)
     and is_active;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.deactivate_push_tokens(text[]) is
  'Service-role only. Retires tokens Expo has reported as DeviceNotRegistered.';

-- ---------------------------------------------------------------------------
-- Grants — the worker only
-- ---------------------------------------------------------------------------
-- `authenticated` is revoked explicitly rather than merely not granted, because
-- PUBLIC holds EXECUTE on new functions by default and a bare CREATE FUNCTION
-- would otherwise leave these reachable from a phone.
revoke all on function public.notifications_pending_push(integer, interval, smallint) from public;
revoke all on function public.mark_notifications_pushed(uuid[], boolean, text)        from public;
revoke all on function public.deactivate_push_tokens(text[])                          from public;

grant execute on function public.notifications_pending_push(integer, interval, smallint) to service_role;
grant execute on function public.mark_notifications_pushed(uuid[], boolean, text)        to service_role;
grant execute on function public.deactivate_push_tokens(text[])                          to service_role;
