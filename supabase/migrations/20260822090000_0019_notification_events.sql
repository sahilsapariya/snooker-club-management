-- ============================================================================
-- 0019 · Raising notifications
-- ============================================================================
-- `public.notifications` has existed since migration 0007 and nothing has ever
-- written to it. The Alerts tab has therefore always been empty: the inbox, its
-- policies and its guard were all correct, but no event ever reached them.
--
-- This migration is the missing half. Events are raised by triggers rather than
-- by the app, for three reasons that matter:
--
--   * A receptionist's phone is not always open. Anything raised client-side is
--     raised only for whoever happens to be looking.
--   * The database is the only place that sees every write. A session closed
--     from a second device still raises the event.
--   * The actor is knowable here. A receptionist who closes a session should
--     not be told that a session was closed - they just closed it.
--
-- Wording is duplicated with `renderNotification()` in the app, deliberately and
-- narrowly: the app renders a *local* notification for the one event it can see
-- itself (a booked time elapsing while the app is in the foreground), and the
-- server renders everything that is persisted or pushed. The two must read
-- identically. If you change wording in one, change it in the other -
-- src/features/notifications/notification-service.ts.

-- ---------------------------------------------------------------------------
-- app.notify_club — the single way a notification comes into existence
-- ---------------------------------------------------------------------------
-- Audience is 'OWNERS' or 'EVERYONE', and the difference is not cosmetic:
--
--   EVERYONE  one row with recipient_user_id NULL. The select policy admits any
--             member of the club, so it reaches whoever is on shift.
--   OWNERS    one row per active owner. A club may now have several, and an
--             owner-only alert must not be readable by reception - the select
--             policy only admits a targeted row to the user it names.
--
-- SECURITY DEFINER because the callers are triggers, and those run both as a
-- signed-in receptionist and as the scheduler (where auth.uid() is NULL).
create or replace function app.notify_club(
  p_tenant_id   uuid,
  p_type        public.notification_type,
  p_title       text,
  p_body        text default null,
  p_audience    text default 'EVERYONE',
  p_entity_type text default null,
  p_entity_id   uuid default null,
  p_metadata    jsonb default '{}'::jsonb,
  p_exclude_user_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
begin
  if p_audience = 'EVERYONE' then
    insert into public.notifications
      (tenant_id, recipient_user_id, type, title, body, entity_type, entity_id, metadata)
    values
      (p_tenant_id, null, p_type, p_title, p_body, p_entity_type, p_entity_id,
       coalesce(p_metadata, '{}'::jsonb));
    return 1;
  end if;

  insert into public.notifications
    (tenant_id, recipient_user_id, type, title, body, entity_type, entity_id, metadata)
  select
    p_tenant_id, m.user_id, p_type, p_title, p_body, p_entity_type, p_entity_id,
    coalesce(p_metadata, '{}'::jsonb)
  from public.tenant_memberships m
  join public.profiles p on p.id = m.user_id
  where m.tenant_id = p_tenant_id
    and m.role = 'OWNER'
    and m.status = 'ACTIVE'
    and p.is_active
    -- Never tell somebody about the thing they just did.
    and (p_exclude_user_id is null or m.user_id <> p_exclude_user_id);

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function app.notify_club(uuid, public.notification_type, text, text, text, text, uuid, jsonb, uuid) is
  'Raises a notification for a club. EVERYONE broadcasts; OWNERS writes one row per active owner, excluding the actor.';

-- ---------------------------------------------------------------------------
-- app.club_name — for the title
-- ---------------------------------------------------------------------------
-- Every notification names its club. On a lock screen there is no active club to
-- infer from, and one owner may run four - "Table 3's time is up" without a club
-- name is worse than no notification at all.
create or replace function app.club_name(p_tenant_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select name from public.tenants where id = p_tenant_id;
$$;

-- ---------------------------------------------------------------------------
-- Session events
-- ---------------------------------------------------------------------------
create or replace function app.notify_session_started()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_table text;
begin
  select name into v_table from public.club_tables where id = new.table_id;

  perform app.notify_club(
    new.tenant_id,
    'SESSION_STARTED',
    format('%s: %s is in play', app.club_name(new.tenant_id), coalesce(v_table, 'A table')),
    'A session has been started.',
    'OWNERS',
    'session', new.id,
    jsonb_build_object('table_id', new.table_id, 'session_id', new.id),
    new.started_by
  );

  return null;
end;
$$;

create trigger sessions_notify_started
  after insert on public.sessions
  for each row
  when (new.status = 'ACTIVE')
  execute function app.notify_session_started();

-- The booked time elapsing is an *event*, not a termination. The session keeps
-- running; this only tells somebody to look at it. Two things can cause the
-- transition - a phone with the app open, or the scheduled sweep in 0021 - and
-- both land here, so the notification is raised exactly once either way.
create or replace function app.notify_session_time_completed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_table   text;
  v_enabled boolean;
begin
  select notify_on_time_completed into v_enabled
    from public.tenant_billing_settings where tenant_id = new.tenant_id;
  if v_enabled is distinct from true then
    return null;
  end if;

  select name into v_table from public.club_tables where id = new.table_id;

  perform app.notify_club(
    new.tenant_id,
    'SESSION_TIME_COMPLETED',
    format('%s: %s''s time is up', app.club_name(new.tenant_id), coalesce(v_table, 'A table')),
    format(
      'The %s minute booking has elapsed. The session is still running until you close it.',
      coalesce(new.planned_duration_minutes, 0)
    ),
    'EVERYONE',
    'session', new.id,
    jsonb_build_object('table_id', new.table_id, 'session_id', new.id)
  );

  return null;
end;
$$;

create trigger sessions_notify_time_completed
  after update of status on public.sessions
  for each row
  when (old.status = 'ACTIVE' and new.status = 'TIME_COMPLETED')
  execute function app.notify_session_time_completed();

create or replace function app.notify_session_closed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_table text;
begin
  select name into v_table from public.club_tables where id = new.table_id;

  perform app.notify_club(
    new.tenant_id,
    'SESSION_CLOSED',
    format('%s: %s is free', app.club_name(new.tenant_id), coalesce(v_table, 'A table')),
    'The session has been closed.',
    'OWNERS',
    'session', new.id,
    jsonb_build_object('table_id', new.table_id, 'session_id', new.id,
                       'total_amount_minor', new.total_amount_minor),
    new.ended_by
  );

  return null;
end;
$$;

create trigger sessions_notify_closed
  after update of status on public.sessions
  for each row
  when (old.status in ('ACTIVE', 'TIME_COMPLETED') and new.status = 'CLOSED')
  execute function app.notify_session_closed();

-- Payment is a separate event from closing, because the two genuinely come
-- apart: a session can close owing money and be settled later.
create or replace function app.notify_payment_received()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_enabled boolean;
begin
  select notify_on_payment into v_enabled
    from public.tenant_billing_settings where tenant_id = new.tenant_id;
  if v_enabled is distinct from true then
    return null;
  end if;

  perform app.notify_club(
    new.tenant_id,
    'PAYMENT_RECEIVED',
    format('%s: payment received', app.club_name(new.tenant_id)),
    format('Paid by %s.', lower(coalesce(new.payment_method::text, 'an unknown method'))),
    'OWNERS',
    'session', new.id,
    jsonb_build_object('session_id', new.id, 'paid_amount_minor', new.paid_amount_minor,
                       'payment_method', new.payment_method),
    new.ended_by
  );

  return null;
end;
$$;

-- Fires on the transition into a paid state, not on every write while in one -
-- otherwise editing a note on a paid session would re-announce the payment.
create trigger sessions_notify_payment
  after update of payment_status on public.sessions
  for each row
  when (
    old.payment_status is distinct from new.payment_status
    and new.payment_status in ('PAID', 'PARTIALLY_PAID')
    and new.paid_amount_minor > 0
  )
  execute function app.notify_payment_received();

-- ---------------------------------------------------------------------------
-- Low stock
-- ---------------------------------------------------------------------------
-- Edge-triggered, not level-triggered. Firing whenever stock is *below* the
-- threshold would raise an alert on every subsequent sale of an already-low
-- product, which is the fastest way to teach staff to ignore alerts entirely.
create or replace function app.notify_low_stock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_enabled boolean;
begin
  select low_stock_alerts_enabled into v_enabled
    from public.tenant_billing_settings where tenant_id = new.tenant_id;
  if v_enabled is distinct from true then
    return null;
  end if;

  perform app.notify_club(
    new.tenant_id,
    'LOW_STOCK',
    format('%s: %s is running low', app.club_name(new.tenant_id), new.name),
    format('%s left in stock.', trim(trailing '.' from trim(trailing '0' from new.stock_quantity::text))),
    'EVERYONE',
    'product', new.id,
    jsonb_build_object('product_id', new.id, 'stock_quantity', new.stock_quantity,
                       'low_stock_threshold', new.low_stock_threshold)
  );

  return null;
end;
$$;

create trigger products_notify_low_stock
  after update of stock_quantity on public.products
  for each row
  when (
    new.track_inventory
    and new.is_active
    and new.low_stock_threshold is not null
    and new.stock_quantity <= new.low_stock_threshold
    and old.stock_quantity > new.low_stock_threshold
  )
  execute function app.notify_low_stock();

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
-- Nothing here is client-callable. The triggers run inside writes the client is
-- already allowed to make; exposing the raiser itself would let a client forge
-- an alert attributed to the club.
revoke all on function app.notify_club(uuid, public.notification_type, text, text, text, text, uuid, jsonb, uuid) from public;
revoke all on function app.club_name(uuid) from public;
