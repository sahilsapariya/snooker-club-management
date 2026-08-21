-- ============================================================================
-- Notification events and the push queue
-- ----------------------------------------------------------------------------
-- `public.notifications` existed from the first migration and nothing ever
-- wrote to it, so the Alerts tab was empty for reasons no test could catch:
-- every policy on the table was correct, and no event ever reached them.
--
-- These assertions pin the half that was missing, in three groups:
--
--   raising    the right event, to the right people, exactly once
--   targeting  an owner-only alert is not readable by reception
--   queueing   what the delivery worker is handed, and what it may touch
--
-- The targeting group is the one that matters most. `recipient_user_id` is not
-- a display hint: the select policy admits a targeted row only to the user it
-- names, so getting the audience wrong is a disclosure, not a UI bug.
-- ============================================================================
begin;
create extension if not exists pgtap with schema extensions;
\ir _helpers.psql
select plan(39);

-- Devices for the people who will be notified. The owner's is deliberately
-- pointed at their *second* club, which is the state a multi-club owner is in
-- most of the time.
select pg_temp.act_as_system();
insert into public.device_push_tokens (user_id, tenant_id, expo_push_token, platform)
values (pg_temp.royal_owner(),     pg_temp.lounge(), 'ExponentPushToken[owner]', 'ANDROID'),
       (pg_temp.royal_reception(), pg_temp.royal(),  'ExponentPushToken[recep]', 'ANDROID'),
       (pg_temp.blue_owner(),      pg_temp.blue(),   'ExponentPushToken[blue]',  'IOS');

-- ---------------------------------------------------------------------------
-- Raising: a session starts
-- ---------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.royal_reception());

select lives_ok(
  format($$insert into public.sessions
             (tenant_id, table_id, status, started_by, planned_duration_minutes)
           select %L, id, 'ACTIVE', %L, 30
             from public.club_tables where tenant_id = %L and name = 'Pool 1'$$,
         pg_temp.royal(), pg_temp.royal_reception(), pg_temp.royal()),
  'a receptionist starts a session');

select pg_temp.act_as_system();

select is(
  (select count(*)::int from public.notifications
    where tenant_id = pg_temp.royal() and type = 'SESSION_STARTED'
      and title like '%Pool 1%'),
  1, 'one SESSION_STARTED is raised');

select is(
  (select recipient_user_id from public.notifications
    where type = 'SESSION_STARTED' and title like '%Pool 1%'),
  pg_temp.royal_owner(),
  'and it is addressed to the owner, not broadcast');

select matches(
  (select title from public.notifications where type = 'SESSION_STARTED' and title like '%Pool 1%'),
  '^Royal Snooker Club: ',
  'every title names its club - a lock screen has no active club to infer from');

-- ---------------------------------------------------------------------------
-- Targeting: an owner-only alert is not readable by reception
-- ---------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.royal_reception());

select is(
  (select count(*)::int from public.notifications where type = 'SESSION_STARTED'),
  0, 'the receptionist who started it is not told about it, and cannot read it');

select pg_temp.act_as(pg_temp.royal_owner());

select isnt(
  (select count(*)::int from public.notifications where type = 'SESSION_STARTED'),
  0, 'the owner can');

select pg_temp.act_as(pg_temp.blue_owner());

select is(
  (select count(*)::int from public.notifications where tenant_id = pg_temp.royal()),
  0, 'another club''s owner sees nothing of it');

-- ---------------------------------------------------------------------------
-- Raising: the booked time elapses
-- ---------------------------------------------------------------------------
select pg_temp.act_as_system();

-- The fixture's own open session is already past its booked time, so drain it
-- first and assert from a known-empty baseline.
select ok(app.sweep_time_completed_sessions() >= 0, 'the sweep runs against the fixture');

select is(
  app.sweep_time_completed_sessions(), 0,
  'a session still within its booked time is left alone');

-- Started backdated rather than updated afterwards: `started_at` is immutable
-- once written (app.sessions_before_write), and rightly so - a session that
-- could be back-dated is a session whose recorded duration means nothing.
insert into public.sessions (tenant_id, table_id, status, started_by, started_at, planned_duration_minutes)
select pg_temp.royal(), id, 'ACTIVE', pg_temp.royal_reception(), now() - interval '45 minutes', 30
  from public.club_tables where tenant_id = pg_temp.royal() and name = 'Pool Mini';

select is(app.sweep_time_completed_sessions(), 1, 'and one whose time is up is flagged');
select is(app.sweep_time_completed_sessions(), 0, 'running it again flags nothing - it is idempotent');

select is(
  (select count(*)::int from public.notifications where type = 'SESSION_TIME_COMPLETED'),
  (select count(*)::int from public.sessions
    where tenant_id = pg_temp.royal() and status = 'TIME_COMPLETED'),
  'one notification per transition, and no more');

select is(
  (select count(*)::int from public.notifications
    where type = 'SESSION_TIME_COMPLETED' and recipient_user_id is not null),
  0, 'time-up is broadcast, because whoever is on shift needs to see it');

select matches(
  (select body from public.notifications
    where type = 'SESSION_TIME_COMPLETED' and title like '%Pool Mini%'),
  'still running until you close it',
  'and the wording reports a state - it never implies the app ended anything');

-- The sweep must not touch a club the platform has stopped.
select pg_temp.act_as(pg_temp.platform_admin());
select lives_ok(
  format($$select public.platform_set_tenant_status(%L, 'SUSPENDED')$$, pg_temp.blue()),
  'the platform suspends a club');

select pg_temp.act_as_system();
insert into public.sessions (tenant_id, table_id, status, started_by, started_at, planned_duration_minutes)
select pg_temp.blue(), id, 'ACTIVE', pg_temp.blue_reception(), now() - interval '90 minutes', 30
  from public.club_tables where tenant_id = pg_temp.blue() limit 1;

select is(app.sweep_time_completed_sessions(), 0,
  'and the sweep passes over its sessions entirely');

select pg_temp.act_as(pg_temp.platform_admin());
select lives_ok(
  format($$select public.platform_set_tenant_status(%L, 'ACTIVE')$$, pg_temp.blue()),
  'restore it for the queue assertions below');

-- ---------------------------------------------------------------------------
-- Raising: the settings toggles are honoured
-- ---------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.royal_owner());
select lives_ok(
  format($$update public.tenant_billing_settings
              set notify_on_time_completed = false where tenant_id = %L$$, pg_temp.royal()),
  'the owner turns time-up alerts off');

select pg_temp.act_as_system();

-- Drain whatever the suspension case left behind at Blue Cue, so the counts
-- below are about this club's toggle and nothing else.
select ok(app.sweep_time_completed_sessions() >= 0, 'the queue of sweepable sessions is drained first');

insert into public.sessions (tenant_id, table_id, status, started_by, started_at, planned_duration_minutes)
select pg_temp.royal(), id, 'ACTIVE', pg_temp.royal_reception(), now() - interval '45 minutes', 30
  from public.club_tables where tenant_id = pg_temp.royal() and name = 'Pool 2';

select is(
  (select count(*)::int from public.notifications
    where type = 'SESSION_TIME_COMPLETED' and title like '%Pool 2%'),
  0, 'nothing has been said about Pool 2 yet');

select is(app.sweep_time_completed_sessions(), 1, 'a new session is still swept');

select is(
  (select count(*)::int from public.notifications
    where type = 'SESSION_TIME_COMPLETED' and title like '%Pool 2%'),
  0, 'but no alert is raised, because the club turned them off');

-- ---------------------------------------------------------------------------
-- Raising: low stock is edge-triggered
-- ---------------------------------------------------------------------------
select pg_temp.act_as_system();
select is((select count(*)::int from public.notifications where type = 'LOW_STOCK'), 1,
  'the fixture raised exactly one low-stock alert');

-- Already below the threshold; selling one more must not re-announce it.
update public.products set stock_quantity = stock_quantity - 1
 where tenant_id = pg_temp.royal() and low_stock_threshold is not null
   and stock_quantity <= low_stock_threshold;

select is((select count(*)::int from public.notifications where type = 'LOW_STOCK'), 1,
  'and selling more of an already-low product does not raise another');

-- ---------------------------------------------------------------------------
-- The till reminder
-- ---------------------------------------------------------------------------
select isnt(app.remind_unclosed_tills(), 0, 'an unreconciled trading day is flagged');
select is(app.remind_unclosed_tills(), 0, 'and flagged once only');

select is(
  (select count(*)::int from public.notifications n
     join public.profiles p on p.id = n.recipient_user_id
    where n.type = 'CASH_CLOSING_REMINDER' and p.email = 'reception@royalsnooker.dev'),
  0, 'the reminder goes to owners, not to reception');

-- ---------------------------------------------------------------------------
-- The queue
-- ---------------------------------------------------------------------------
-- The owner's device is registered against Cue Lounge, yet must still be found
-- for a Royal Snooker alert. Resolving recipients through the token's own
-- tenant_id instead of through memberships would silently stop delivering every
-- club an owner is not currently looking at.
select isnt(
  (select count(*)::int from public.notifications_pending_push()
    where tenant_id = pg_temp.royal()
      and 'ExponentPushToken[owner]' = any(tokens)),
  0, 'a multi-club owner is reached for a club their device is not pointed at');

select is(
  (select count(*)::int from public.notifications_pending_push()
    where 'ExponentPushToken[blue]' = any(tokens) and tenant_id = pg_temp.royal()),
  0, 'and another club''s device is never in a Royal Snooker batch');

-- Named rather than `limit 1`: inside a transaction `now()` is frozen, so every
-- row written here shares a created_at and any ordered LIMIT is a coin toss.
select is(
  (select cardinality(tokens) from public.notifications_pending_push()
    where type = 'SESSION_TIME_COMPLETED' and title like '%Pool Mini%'),
  2, 'a broadcast reaches both devices on shift at that club');

select is(
  (select count(*)::int from public.notifications_pending_push()
    where type = 'SESSION_STARTED' and 'ExponentPushToken[recep]' = any(tokens)),
  0, 'an owner-targeted alert never reaches a receptionist''s device');

-- Marking pushed drains it; a failed attempt is counted but stays queued.
select isnt(
  public.mark_notifications_pushed(
    array(select notification_id from public.notifications_pending_push())),
  0, 'the worker records a successful delivery');

select is(
  (select count(*)::int from public.notifications_pending_push()), 0,
  'and the queue is drained');

insert into public.notifications (tenant_id, type, title)
values (pg_temp.royal(), 'SYSTEM_ALERT', 'Retry me');

select is(
  public.mark_notifications_pushed(
    array(select id from public.notifications where title = 'Retry me'), false, 'expo timeout'),
  1, 'a failed attempt is recorded');

select is(
  (select push_attempts::int from public.notifications where title = 'Retry me'),
  1, 'the attempt is counted');

select is(
  (select pushed_at from public.notifications where title = 'Retry me'),
  null, 'but the row is not marked sent, so it will be retried');

-- ---------------------------------------------------------------------------
-- What a client may not touch
-- ---------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.royal_reception());

select throws_ok(
  $$update public.notifications set pushed_at = now() where recipient_user_id is null$$,
  '42501', null,
  'a client cannot mark a notification as pushed and suppress everyone else''s alert');

select is(
  pg_temp.rows_affected($$update public.notifications set read_at = now()
                           where recipient_user_id is null$$) > 0,
  true, 'but marking it read still works');

select throws_ok(
  $$select public.notifications_pending_push()$$,
  '42501', null,
  'and the delivery queue is not readable from a phone');

select * from finish();
rollback;
