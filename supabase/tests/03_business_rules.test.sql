-- ============================================================================
-- Business rules and data integrity
-- ----------------------------------------------------------------------------
-- These are the invariants the product cannot be allowed to lose, encoded as
-- constraints and generated columns rather than as application discipline.
--
-- Most assertions run with RLS bypassed on purpose: the point here is that the
-- rule holds for *every* writer, including a trusted server-side one.
-- ============================================================================
begin;
create extension if not exists pgtap with schema extensions;
\ir _helpers.psql
select plan(48);

select pg_temp.act_as_system();

create or replace function pg_temp.royal_table(p_name text) returns uuid language sql stable as $fn$
  select id from public.club_tables
   where tenant_id = 'aaaaaaaa-0000-4000-8000-000000000001'::uuid and name = p_name
$fn$;

-- The seed contains a few days of real trade now, so "the session on Pool 2" is
-- no longer a unique row. Every session this file creates leaves customer_name
-- null and every seeded one sets it, which is what tells them apart - and is
-- more robust than "the most recent", which two inserts in the same transaction
-- would tie on anyway.
create or replace function pg_temp.test_session(p_table text) returns uuid language sql stable as $fn$
  select s.id
    from public.sessions s
   where s.table_id = pg_temp.royal_table(p_table)
     and s.customer_name is null
$fn$;

-- ---------------------------------------------------------------------------
-- Actual duration is a recorded fact, never a billing output
-- ---------------------------------------------------------------------------
-- A club that sells 60-minute slots, with a player who stayed 67 minutes.
insert into public.sessions (
  tenant_id, table_id, status, started_at, ended_at,
  planned_duration_minutes, billable_duration_seconds, table_charge_minor
)
values (
  'aaaaaaaa-0000-4000-8000-000000000001', pg_temp.royal_table('Pool 2'), 'CLOSED',
  now() - interval '67 minutes', now(),
  60, 3600, 15000
);

select is(
  (select actual_duration_seconds from public.sessions
    where id = pg_temp.test_session('Pool 2')),
  4020, 'the full 67 minutes actually played is recorded');

select is(
  (select billable_duration_seconds from public.sessions
    where id = pg_temp.test_session('Pool 2')),
  3600, 'the billed duration is the configured 60 minutes');

select isnt(
  (select actual_duration_seconds from public.sessions where id = pg_temp.test_session('Pool 2')),
  (select billable_duration_seconds from public.sessions where id = pg_temp.test_session('Pool 2')),
  'the two are independent values, and here they differ');

select throws_ok(
  $$update public.sessions set actual_duration_seconds = 3600$$,
  '428C9', null,
  'actual duration cannot be overwritten by any writer - it is a generated column');

select throws_ok(
  $$insert into public.sessions (tenant_id, table_id, business_date, actual_duration_seconds)
    values ('aaaaaaaa-0000-4000-8000-000000000001',
            (select id from public.club_tables where name = 'Snooker 2'), current_date, 60)$$,
  '428C9', null,
  'actual duration cannot be supplied at insert time either');

select throws_ok(
  $$update public.sessions set started_at = now()
     where table_id = (select id from public.club_tables where name = 'Pool 2')$$,
  '23514', null,
  'the recorded start time is immutable');

-- ---------------------------------------------------------------------------
-- A session never ends by itself
-- ---------------------------------------------------------------------------
select throws_ok(
  $$insert into public.sessions (tenant_id, table_id, business_date, status, ended_at)
    values ('aaaaaaaa-0000-4000-8000-000000000001',
            (select id from public.club_tables where name = 'Snooker 2'),
            current_date, 'ACTIVE', now())$$,
  '23514', null,
  'an open session cannot carry an end time');

select throws_ok(
  $$insert into public.sessions (tenant_id, table_id, business_date, status)
    values ('aaaaaaaa-0000-4000-8000-000000000001',
            (select id from public.club_tables where name = 'Snooker 2'),
            current_date, 'CLOSED')$$,
  '23514', null,
  'a closed session must carry an end time');

-- Passing the booked time is a state change, not a termination.
insert into public.sessions (tenant_id, table_id, status, started_at, planned_duration_minutes)
values ('aaaaaaaa-0000-4000-8000-000000000001', pg_temp.royal_table('Snooker 2'), 'ACTIVE',
        now() - interval '75 minutes', 60);

update public.sessions
   set status = 'TIME_COMPLETED', time_completed_at = now()
 where id = pg_temp.test_session('Snooker 2');

select is(
  (select ended_at from public.sessions where id = pg_temp.test_session('Snooker 2')),
  null, 'reaching the booked time does not end the session');
select is(
  (select actual_duration_seconds from public.sessions where id = pg_temp.test_session('Snooker 2')),
  null, 'a still-running session has no actual duration yet');

select throws_ok(
  $$insert into public.sessions (tenant_id, table_id, business_date, status)
    values ('aaaaaaaa-0000-4000-8000-000000000001',
            (select id from public.club_tables where name = 'Snooker 2'),
            current_date, 'ACTIVE')$$,
  '23505', null,
  'a table that is still occupied cannot take a second open session');

-- ---------------------------------------------------------------------------
-- Historical prices never change
-- ---------------------------------------------------------------------------
insert into public.sessions (tenant_id, table_id, status, started_by)
values ('aaaaaaaa-0000-4000-8000-000000000001', pg_temp.royal_table('Pool 1'), 'ACTIVE',
        '33333333-3333-4333-8333-333333333333');

insert into public.session_items (tenant_id, session_id, product_id, quantity, product_name_snapshot, unit_price_minor)
select 'aaaaaaaa-0000-4000-8000-000000000001', s.id, p.id, 3, '', null
from public.sessions s
join public.products p on p.tenant_id = s.tenant_id and p.name = 'Lemon Soda'
where s.id = pg_temp.test_session('Pool 1');

select is(
  (select unit_price_minor from public.session_items si
    join public.sessions s on s.id = si.session_id
   where s.id = pg_temp.test_session('Pool 1')),
  3500::bigint, 'the sale price is snapshotted from the catalogue');

select is(
  (select line_total_minor from public.session_items si
    join public.sessions s on s.id = si.session_id
   where s.id = pg_temp.test_session('Pool 1')),
  10500::bigint, 'the line total is computed from the snapshot');

-- Raise the catalogue price; yesterday's bill must not move.
update public.products set selling_price_minor = 9900
 where tenant_id = 'aaaaaaaa-0000-4000-8000-000000000001' and name = 'Lemon Soda';

select is(
  (select line_total_minor from public.session_items si
    join public.sessions s on s.id = si.session_id
   where s.id = pg_temp.test_session('Pool 1')),
  10500::bigint, 'raising the catalogue price does not rewrite the existing bill');

select throws_ok(
  $$update public.session_items set unit_price_minor = 1$$,
  '23514', null,
  'the price snapshot on a sold line is immutable');

select is(
  (select total_amount_minor from public.sessions where id = pg_temp.test_session('Pool 1')),
  10500::bigint, 'the session total rolls up from its items');

-- ---------------------------------------------------------------------------
-- Stock is a ledger
-- ---------------------------------------------------------------------------
select is(
  (select stock_quantity from public.products
    where tenant_id = 'aaaaaaaa-0000-4000-8000-000000000001' and name = 'Lemon Soda'),
  45::numeric, 'selling three units moves stock from 48 to 45');

select is(
  (select count(*)::int from public.inventory_movements im
    join public.products p on p.id = im.product_id
   where p.name = 'Lemon Soda' and im.movement_type = 'SALE'),
  1, 'the sale is recorded as a stock movement, not just a decrement');

delete from public.session_items si
 using public.sessions s
 where si.session_id = s.id and s.id = pg_temp.test_session('Pool 1');

select is(
  (select stock_quantity from public.products
    where tenant_id = 'aaaaaaaa-0000-4000-8000-000000000001' and name = 'Lemon Soda'),
  48::numeric, 'removing the line restores the stock');

select is(
  (select count(*)::int from public.inventory_movements im
    join public.products p on p.id = im.product_id
   where p.name = 'Lemon Soda' and im.movement_type = 'CORRECTION'),
  1, 'and does so by appending a correction, never by editing the ledger');

-- Items may only be attached to an open session.
update public.sessions set status = 'CLOSED', ended_at = now()
 where id = pg_temp.test_session('Pool 1');

select throws_ok(
  $$insert into public.session_items (tenant_id, session_id, product_id, quantity, product_name_snapshot, unit_price_minor)
    select 'aaaaaaaa-0000-4000-8000-000000000001', s.id, p.id, 1, '', null
      from public.sessions s
      join public.products p on p.tenant_id = s.tenant_id and p.name = 'Lemon Soda'
     where s.table_id = (select id from public.club_tables where name = 'Pool 1')$$,
  '23514', null,
  'nothing can be added to a closed session');

-- ---------------------------------------------------------------------------
-- Cross-tenant references are impossible, independently of RLS
-- ---------------------------------------------------------------------------
select throws_ok(
  $$insert into public.club_tables (tenant_id, table_type_id, name)
    values ('aaaaaaaa-0000-4000-8000-000000000001',
            (select id from public.table_types
              where tenant_id = 'bbbbbbbb-0000-4000-8000-000000000002' limit 1),
            'Illegal Table')$$,
  '23503', null,
  'a table cannot reference another tenant''s table type');

select throws_ok(
  $$insert into public.products (tenant_id, category_id, name, selling_price_minor)
    values ('aaaaaaaa-0000-4000-8000-000000000001',
            (select id from public.product_categories
              where tenant_id = 'bbbbbbbb-0000-4000-8000-000000000002' limit 1),
            'Illegal Product', 1000)$$,
  '23503', null,
  'a product cannot reference another tenant''s category');

select throws_ok(
  $$insert into public.expenses (tenant_id, category_id, amount_minor, expense_date)
    values ('aaaaaaaa-0000-4000-8000-000000000001',
            (select id from public.expense_categories
              where tenant_id = 'bbbbbbbb-0000-4000-8000-000000000002' limit 1),
            1000, current_date)$$,
  '23503', null,
  'an expense cannot reference another tenant''s category');

-- ---------------------------------------------------------------------------
-- Business dates follow the club's own clock, not the server's
-- ---------------------------------------------------------------------------
-- 2026-08-20 20:00Z is 2026-08-21 01:30 in Kolkata. Royal trades until 04:00,
-- so that still belongs to the 20th; Blue Cue's day rolls at midnight.
select is(
  app.business_date(timestamptz '2026-08-20 20:00:00+00', 'Asia/Kolkata', time '04:00'),
  date '2026-08-20',
  'a club trading past midnight books 01:30 to the previous business day');

select is(
  app.business_date(timestamptz '2026-08-20 20:00:00+00', 'Asia/Kolkata', time '00:00'),
  date '2026-08-21',
  'a club closing at midnight books the same instant to the next day');

-- ---------------------------------------------------------------------------
-- Money and configuration constraints
-- ---------------------------------------------------------------------------
select throws_ok(
  $$update public.sessions set discount_minor = 999999
     where table_id = (select id from public.club_tables where name = 'Pool 2')$$,
  '23514', null,
  'a discount cannot exceed what was charged');

select throws_ok(
  $$update public.tenants set primary_color = 'green' where slug = 'blue-cue'$$,
  '23514', null,
  'branding colours must be valid hex');

select throws_ok(
  $$update public.tenants set timezone = 'Mars/Olympus' where slug = 'blue-cue'$$,
  '23514', null,
  'a club timezone must be a real timezone');

select throws_ok(
  $$insert into public.tenants (slug, name) values ('Not A Slug!', 'Bad Slug Club')$$,
  '23514', null,
  'tenant slugs are validated');

select throws_ok(
  $$update public.tenant_billing_settings set overtime_mode = 'OVERTIME_RATE', overtime_rate_minor = null
     where tenant_id = 'aaaaaaaa-0000-4000-8000-000000000001'$$,
  '23514', null,
  'choosing an overtime rate mode requires an overtime rate');

select throws_ok(
  $$update public.tenant_billing_settings set frame_billing_enabled = true, default_frame_price_minor = null
     where tenant_id = 'bbbbbbbb-0000-4000-8000-000000000002'$$,
  '23514', null,
  'enabling frame billing requires a frame price');

select throws_ok(
  $$insert into public.pricing_rules (tenant_id, name, pricing_mode, rate_minor)
    values ('aaaaaaaa-0000-4000-8000-000000000001', 'Frames', 'PER_FRAME', 0)$$,
  '23514', null,
  'per-frame pricing requires a frame price');

select throws_ok(
  $$insert into public.pricing_rules (tenant_id, table_type_id, name, pricing_mode, rate_minor, is_default)
    select 'aaaaaaaa-0000-4000-8000-000000000001', id, 'Duplicate default', 'PER_HOUR', 100, true
      from public.table_types
     where tenant_id = 'aaaaaaaa-0000-4000-8000-000000000001' and code = 'SNOOKER'$$,
  '23505', null,
  'a scope can only have one active default pricing rule');

-- Cash reconciliation arithmetic is computed, not typed in.
insert into public.cash_closings (tenant_id, business_date, opening_cash_minor,
                                  cash_received_minor, cash_expenses_minor, actual_cash_minor)
values ('aaaaaaaa-0000-4000-8000-000000000001', current_date - 7, 500000, 1250000, 300000, 1400000);

select is(
  (select expected_cash_minor from public.cash_closings where business_date = current_date - 7),
  1450000::bigint, 'expected cash is derived from opening + received - expenses');
select is(
  (select difference_minor from public.cash_closings where business_date = current_date - 7),
  -50000::bigint, 'the shortfall against the counted cash is derived too');

select throws_ok(
  $$update public.cash_closings set status = 'CLOSED', closed_at = now(), actual_cash_minor = null
     where business_date = current_date - 7$$,
  '23514', null,
  'a till cannot be closed without a counted amount');

-- The same product name is fine in two different clubs.
select lives_ok(
  $$insert into public.products (tenant_id, name, selling_price_minor)
    values ('bbbbbbbb-0000-4000-8000-000000000002', 'Lemon Soda', 4000)$$,
  'two clubs may each have a product with the same name');

select throws_ok(
  $$insert into public.products (tenant_id, name, selling_price_minor)
    values ('aaaaaaaa-0000-4000-8000-000000000001', 'lemon soda', 4000)$$,
  '23505', null,
  'but one club cannot have the same product name twice');

-- ---------------------------------------------------------------------------
-- The full session lifecycle, as the app now drives it
-- ---------------------------------------------------------------------------
-- These mirror what features/sessions does over PostgREST: start, flag the
-- booked time, sell a drink, close and take payment. Each step is asserted
-- against the constraints rather than against the client's good intentions.

-- Start: no end time, ACTIVE, business date derived server-side.
insert into public.sessions (tenant_id, table_id, status, started_by, planned_duration_minutes,
                             pricing_snapshot, business_date)
select 'aaaaaaaa-0000-4000-8000-000000000001', pg_temp.royal_table('Pool Mini'), 'ACTIVE',
       '33333333-3333-4333-8333-333333333333', 60,
       jsonb_build_object('pricing_mode', 'PER_HOUR', 'rate_minor', 36000),
       date '1999-01-01';   -- deliberately wrong; the trigger must overwrite it

select isnt(
  (select business_date from public.sessions where id = pg_temp.test_session('Pool Mini')),
  date '1999-01-01',
  'a client cannot forge the business date - the trigger derives it');

select is(
  (select status::text from public.sessions where id = pg_temp.test_session('Pool Mini')),
  'ACTIVE', 'a started session is open');

-- The booked time elapses. This is a state change, not an ending.
update public.sessions
   set status = 'TIME_COMPLETED', time_completed_at = now()
 where id = pg_temp.test_session('Pool Mini');

select is(
  (select ended_at from public.sessions where id = pg_temp.test_session('Pool Mini')),
  null, 'flagging the booked time does not end the session');

select is(
  (select actual_duration_seconds from public.sessions where id = pg_temp.test_session('Pool Mini')),
  null, 'and no actual duration exists while it is still running');

-- A drink is sold against it.
insert into public.session_items (tenant_id, session_id, product_id, quantity, added_by,
                                  product_name_snapshot, unit_price_minor)
select s.tenant_id, s.id, p.id, 2, '33333333-3333-4333-8333-333333333333', '', null
from public.sessions s
join public.products p on p.tenant_id = s.tenant_id and p.name = 'Potato Chips'
where s.id = pg_temp.test_session('Pool Mini');

select is(
  (select items_total_minor from public.sessions where id = pg_temp.test_session('Pool Mini')),
  5000::bigint, 'selling a drink rolls onto the session total');

-- Close and take payment. The client sends billable time and the table charge;
-- actual duration and the grand total are computed by Postgres.
update public.sessions
   set status = 'CLOSED',
       ended_at = started_at + interval '67 minutes',
       ended_by = '33333333-3333-4333-8333-333333333333',
       billable_duration_seconds = 3600,
       table_charge_minor = 36000,
       payment_status = 'PAID',
       payment_method = 'CASH',
       paid_amount_minor = 41000,
       paid_at = now()
 where id = pg_temp.test_session('Pool Mini');

select is(
  (select actual_duration_seconds from public.sessions where id = pg_temp.test_session('Pool Mini')),
  4020, 'the database records all 67 minutes actually played');

select is(
  (select billable_duration_seconds from public.sessions where id = pg_temp.test_session('Pool Mini')),
  3600, 'while the club billed the 60 minutes it decided to');

select is(
  (select total_amount_minor from public.sessions where id = pg_temp.test_session('Pool Mini')),
  41000::bigint, 'the grand total is generated from the table charge plus items');

-- Reopening is refused outright rather than silently matching nothing: the
-- immutability guard fires before the terminal-state constraint is even reached.
select throws_ok(
  $$update public.sessions set status = 'ACTIVE', ended_at = null
     where table_id = (select id from public.club_tables where name = 'Pool Mini')$$,
  '23514', null,
  'a closed session cannot be reopened - its end time is immutable');

select * from finish();
rollback;
