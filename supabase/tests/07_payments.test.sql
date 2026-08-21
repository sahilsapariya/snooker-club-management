-- ============================================================================
-- The payments ledger
-- ----------------------------------------------------------------------------
-- Before this, a session carried one amount and one method. That is enough for
-- a bill paid once, in full, on the day it closed - and wrong for everything
-- else. Two failures in particular were silent:
--
--   a bill settled half in cash and half by UPI had one method discarded, and
--   a debt settled days later was counted into the ORIGINAL day's drawer.
--
-- The second is the dangerous one. Nobody would report it as a bug; the till
-- would simply come up over on one day and short on another, and the club would
-- conclude the app cannot count.
--
-- These assertions cover three things: that the ledger and the session can
-- never disagree, that a client cannot choose which till its money lands in,
-- and that the money readers attribute cash to the day it arrived while
-- attributing trade to the day it was earned.
-- ============================================================================
begin;
create extension if not exists pgtap with schema extensions;
\ir _helpers.psql
select plan(29);

-- ---------------------------------------------------------------------------
-- The session follows the ledger, never the other way round
-- ---------------------------------------------------------------------------
-- Captured up front. The seed contains real trade now, so "the session with a
-- 30000 charge" is not a unique row - and a test that matches on an amount will
-- start failing the moment a fixture happens to use the same number.
select id as sid from public.sessions where status = 'ACTIVE' \gset

select pg_temp.act_as(pg_temp.royal_reception());

select lives_ok(
  format($$select public.close_session(%L, 3600, 30000, 0, 0, 0, null, null)$$, :'sid'),
  'a session can be closed taking no money at all');

select is(
  (select payment_status::text from public.sessions where id = :'sid'),
  'UNPAID', 'and it is unpaid, not silently marked settled');

select is(
  (select count(*)::int from public.v_outstanding_sessions where id = :'sid'),
  1, 'so it appears as a debt straight away');

select lives_ok(
  format($$insert into public.session_payments (tenant_id, session_id, amount_minor, method, received_by)
           values (%L, %L, 20000, 'CASH', %L)$$,
         pg_temp.royal(), :'sid', pg_temp.royal_reception()),
  'a part payment in cash is recorded');

select is(
  (select payment_status::text from public.sessions where id = :'sid'),
  'PARTIALLY_PAID', 'the session moves to partially paid on its own');

select is(
  (select paid_amount_minor from public.sessions where id = :'sid'),
  20000::bigint, 'and its total is the sum of the ledger, not a number somebody wrote');

select lives_ok(
  format($$insert into public.session_payments (tenant_id, session_id, amount_minor, method, received_by)
           values (%L, %L, 14000, 'UPI', %L)$$,
         pg_temp.royal(), :'sid', pg_temp.royal_reception()),
  'the balance is settled by a different method');

select is(
  (select payment_status::text from public.sessions where id = :'sid'),
  'PAID', 'which settles it');

select is(
  (select count(*)::int from public.session_payments where session_id = :'sid'),
  2, 'and both payments survive, with their own methods');

select is(
  (select count(*)::int from public.v_outstanding_sessions where id = :'sid'),
  0, 'the debt is gone');

-- ---------------------------------------------------------------------------
-- A client cannot choose which till its money lands in
-- ---------------------------------------------------------------------------
select throws_ok(
  format($$insert into public.session_payments (tenant_id, session_id, amount_minor, method, received_by)
           values (%L, %L, 100, 'CASH', %L)$$,
         pg_temp.royal(), :'sid', pg_temp.royal_reception()),
  '23514', null,
  'paying more than is owed is refused - the difference is change, not a payment');

select pg_temp.act_as_system();
insert into public.sessions (tenant_id, table_id, status, started_by, started_at, ended_at, ended_by,
                             billable_duration_seconds, table_charge_minor, customer_name)
select pg_temp.royal(), id, 'CLOSED', pg_temp.royal_reception(),
       now() - interval '3 hours', now() - interval '2 hours', pg_temp.royal_reception(),
       3600, 50000, 'Ledger case'
  from public.club_tables where tenant_id = pg_temp.royal() and name = 'Pool 1';
select id as second from public.sessions where customer_name = 'Ledger case' \gset

select pg_temp.act_as(pg_temp.royal_reception());

select lives_ok(
  format($$insert into public.session_payments
             (tenant_id, session_id, amount_minor, method, received_by, business_date, created_at)
           values (%L, %L, 5000, 'CASH', %L, '2020-01-01', '2020-01-01 10:00:00+00')$$,
         pg_temp.royal(), :'second', pg_temp.royal_reception()),
  'a payment sent with a made-up date is accepted');

select isnt(
  (select business_date from public.session_payments where session_id = :'second'),
  '2020-01-01'::date,
  '...but the date is discarded - a client cannot post into a till already counted');

select isnt(
  (select created_at::date from public.session_payments where session_id = :'second'),
  '2020-01-01'::date,
  'and neither is the timestamp it would have been derived from');

select throws_ok(
  format($$insert into public.session_payments (tenant_id, session_id, amount_minor, method, received_by)
           values (%L, %L, 100, 'CASH', %L)$$,
         pg_temp.royal(), :'second', pg_temp.royal_owner()),
  '42501', null,
  'and a receptionist cannot record a payment as somebody else');

-- ---------------------------------------------------------------------------
-- Corrections
-- ---------------------------------------------------------------------------
select throws_ok(
  format($$update public.session_payments set amount_minor = 1 where session_id = %L$$, :'second'),
  '42501', null,
  'a payment cannot be edited - the correction is to remove it and record the right one');

select is(
  pg_temp.rows_affected(format($$delete from public.session_payments where session_id = %L$$, :'second')),
  0, 'a receptionist cannot remove one either');

select pg_temp.act_as(pg_temp.royal_owner());

select is(
  pg_temp.rows_affected(format($$delete from public.session_payments where session_id = %L$$, :'second')),
  1, 'the owner can remove one recorded in error');

select is(
  (select paid_amount_minor from public.sessions where id = :'second'),
  0::bigint, 'and the session''s total follows it back down');

select is(
  (select payment_status::text from public.sessions where id = :'second'),
  'UNPAID', 'including its status');

-- ---------------------------------------------------------------------------
-- Cash lands on the day it arrived; trade stays on the day it was earned
-- ---------------------------------------------------------------------------
select pg_temp.act_as_system();
select business_date as day from public.sessions where id = :'second' \gset

insert into public.session_payments (tenant_id, session_id, amount_minor, method, received_by)
values (pg_temp.royal(), :'second', 50000, 'CASH', pg_temp.royal_reception());

-- Simulate the money arriving four days after the session was played.
update public.session_payments set business_date = business_date + 4 where session_id = :'second';

select pg_temp.act_as(pg_temp.royal_owner());

select is(
  (select cash_received_minor from public.daily_cash_summary(pg_temp.royal(), :'day'::date)),
  (select coalesce(sum(p.amount_minor), 0)::bigint from public.session_payments p
    where p.tenant_id = pg_temp.royal() and p.business_date = :'day'::date and p.method = 'CASH'),
  'the day of trade holds only the cash that actually arrived that day');

select is(
  (select cash_received_minor from public.daily_cash_summary(pg_temp.royal(), :'day'::date + 4)),
  50000::bigint, 'and the later settlement lands on the day the drawer received it');

select is(
  (select sessions_closed from public.daily_cash_summary(pg_temp.royal(), :'day'::date + 4)),
  0, 'a day with a settlement but no trade shows no sessions closed');

-- The revenue report answers the other question, and must not have moved.
select is(
  (select collected_minor from public.report_revenue_summary(pg_temp.royal(), :'day'::date, :'day'::date)),
  (select coalesce(sum(s.paid_amount_minor), 0)::bigint from public.sessions s
    where s.tenant_id = pg_temp.royal() and s.business_date = :'day'::date and s.status = 'CLOSED'),
  'the revenue report still credits a debt to the day the trade happened');

-- A split payment must not be reported as though it were all one method.
select is(
  (select cash_minor + non_cash_minor
     from public.report_revenue_summary(pg_temp.royal(), :'day'::date - 30, :'day'::date + 30)),
  (select coalesce(sum(s.paid_amount_minor), 0)::bigint from public.sessions s
    where s.tenant_id = pg_temp.royal() and s.status = 'CLOSED'),
  'the cash and non-cash split adds back up to everything collected');

select isnt(
  (select non_cash_minor from public.report_revenue_summary(pg_temp.royal(), :'day'::date - 30, :'day'::date + 30)),
  0::bigint, 'and a bill paid partly by UPI is not reported as entirely cash');

-- ---------------------------------------------------------------------------
-- Isolation
-- ---------------------------------------------------------------------------
-- Captured while it is still visible: a Blue Cue owner cannot see a Royal
-- Snooker session at all, so naming one in a subquery below would yield NULL
-- and the insert would fail for the wrong reason.
select pg_temp.act_as_system();
select id as royal_debt from public.sessions
 where tenant_id = pg_temp.royal() and customer_name = 'Deepa' \gset

select pg_temp.act_as(pg_temp.blue_owner());

select is(
  (select count(*)::int from public.session_payments where tenant_id = pg_temp.royal()),
  0, 'another club''s owner sees none of these payments');

select is(
  (select count(*)::int from public.v_outstanding_sessions where tenant_id = pg_temp.royal()),
  0, 'nor any of its debts');

-- Aimed at a session that still owes money, so the refusal is RLS and not the
-- overpayment guard - which runs first and would mask it.
select throws_ok(
  format($$insert into public.session_payments (tenant_id, session_id, amount_minor, method, received_by)
           values (%L, %L, 100, 'CASH', %L)$$,
         pg_temp.royal(), :'royal_debt', pg_temp.blue_owner()),
  '42501', null,
  'and cannot record a payment against it, even naming it directly');

select * from finish();
rollback;
