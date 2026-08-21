-- ============================================================================
-- Tenant isolation
-- ----------------------------------------------------------------------------
-- The single most important property of this product: a signed-in user of
-- Royal Snooker Club must be unable to see, change or create anything
-- belonging to Blue Cue Club - by any route, including views.
--
-- These tests run as the `authenticated` Postgres role so that RLS is actually
-- in force. Running them as `postgres` would prove nothing: that role has
-- BYPASSRLS.
-- ============================================================================
begin;
create extension if not exists pgtap with schema extensions;
\ir _helpers.psql
select plan(42);

-- ---------------------------------------------------------------------------
-- Reads: a member sees their own club and nothing else
-- ---------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.royal_owner());

-- This owner runs two clubs (Royal Snooker and Cue Lounge), so "their own
-- club" is a set, not a row. What isolation means for them is that the set
-- contains their clubs and no others - not that it has one element.
select is((select count(*)::int from public.tenants), 2,
          'Royal owner sees exactly their two clubs');
select set_eq(
  $$select id from public.tenants$$,
  $$values ('aaaaaaaa-0000-4000-8000-000000000001'::uuid),
           ('cccccccc-0000-4000-8000-000000000003'::uuid)$$,
  'and they are the two they own');
select is((select count(*)::int from public.tenants where id = pg_temp.blue()), 0,
          'Royal owner cannot read the Blue Cue tenant row');

select is((select count(*)::int from public.club_tables where tenant_id = pg_temp.royal()), 5,
          'Royal owner sees their first club''s five tables');
select is((select count(*)::int from public.club_tables where tenant_id = pg_temp.blue()), 0,
          'Royal owner sees zero Blue Cue tables');
select is((select count(*)::int from public.products where tenant_id = pg_temp.blue()), 0,
          'Royal owner sees zero Blue Cue products');
select is((select count(*)::int from public.pricing_rules where tenant_id = pg_temp.blue()), 0,
          'Royal owner sees zero Blue Cue pricing rules');
select is((select count(*)::int from public.expenses where tenant_id = pg_temp.blue()), 0,
          'Royal owner sees zero Blue Cue expenses');
select is((select count(*)::int from public.equipment where tenant_id = pg_temp.blue()), 0,
          'Royal owner sees zero Blue Cue equipment');
select is((select count(*)::int from public.tenant_memberships where tenant_id = pg_temp.blue()), 0,
          'Royal owner sees zero Blue Cue memberships');
select is((select count(*)::int from public.inventory_movements where tenant_id = pg_temp.blue()), 0,
          'Royal owner sees zero Blue Cue stock movements');
select is((select count(*)::int from public.tenant_billing_settings where tenant_id = pg_temp.blue()), 0,
          'Royal owner sees zero Blue Cue billing settings');

-- Views must not become a side door. v_club_table_overview is declared
-- security_invoker, so the caller's RLS still applies - and for a multi-club
-- owner that means both of their clubs and nothing beyond them.
select is((select count(*)::int from public.v_club_table_overview
            where tenant_id = pg_temp.royal()), 5,
          'the tables read model is filtered to the caller''s clubs');
select is((select count(distinct tenant_id)::int from public.v_club_table_overview), 2,
          'and spans exactly the two clubs they own');
select is((select count(*)::int from public.v_club_table_overview where tenant_id = pg_temp.blue()), 0,
          'the tables read model leaks no Blue Cue rows');
select is((select count(*)::int from public.v_low_stock_products where tenant_id = pg_temp.blue()), 0,
          'the low stock read model leaks no Blue Cue rows');

-- The reverse direction.
select pg_temp.act_as(pg_temp.blue_owner());
select is((select count(*)::int from public.club_tables where tenant_id = pg_temp.royal()), 0,
          'Blue owner sees zero Royal tables');
select is((select count(*)::int from public.sessions where tenant_id = pg_temp.royal()), 0,
          'Blue owner sees zero Royal sessions');
select is((select count(*)::int from public.session_items where tenant_id = pg_temp.royal()), 0,
          'Blue owner sees zero Royal session items');
select is((select count(*)::int from public.notifications where tenant_id = pg_temp.royal()), 0,
          'Blue owner sees zero Royal notifications');

-- ---------------------------------------------------------------------------
-- Writes: cross-tenant mutation is impossible
-- ---------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.royal_owner());

select is(
  pg_temp.rows_affected(
    $$update public.club_tables set name = 'HIJACKED'
       where tenant_id = 'bbbbbbbb-0000-4000-8000-000000000002'$$),
  0, 'Royal owner updating Blue Cue tables affects zero rows');

select is(
  pg_temp.rows_affected(
    $$delete from public.products
       where tenant_id = 'bbbbbbbb-0000-4000-8000-000000000002'$$),
  0, 'Royal owner deleting Blue Cue products affects zero rows');

select throws_ok(
  $$insert into public.products (tenant_id, name, selling_price_minor)
    values ('bbbbbbbb-0000-4000-8000-000000000002', 'Smuggled Soda', 1000)$$,
  '42501', null,
  'inserting a product into another tenant is refused by RLS');

select throws_ok(
  $$insert into public.expenses (tenant_id, amount_minor, expense_date)
    values ('bbbbbbbb-0000-4000-8000-000000000002', 5000, current_date)$$,
  '42501', null,
  'inserting an expense into another tenant is refused by RLS');

select throws_ok(
  $$insert into public.notifications (tenant_id, type, title)
    values ('bbbbbbbb-0000-4000-8000-000000000002', 'SYSTEM_ALERT', 'spoofed')$$,
  '42501', null,
  'raising a notification in another tenant is refused by RLS');

-- Confirm nothing actually changed in the other club.
select pg_temp.act_as_system();
select is((select count(*)::int from public.club_tables where tenant_id = pg_temp.blue() and name = 'HIJACKED'),
          0, 'no Blue Cue table was renamed');
select is((select count(*)::int from public.products where tenant_id = pg_temp.blue()), 3,
          'Blue Cue still has all three products');

-- ---------------------------------------------------------------------------
-- Unauthenticated access
-- ---------------------------------------------------------------------------
select pg_temp.act_as_anon();
select throws_ok($$select count(*) from public.tenants$$, '42501', null,
                 'anonymous callers cannot read tenants');
select throws_ok($$select count(*) from public.club_tables$$, '42501', null,
                 'anonymous callers cannot read club tables');
select throws_ok($$select count(*) from public.sessions$$, '42501', null,
                 'anonymous callers cannot read sessions');

-- ---------------------------------------------------------------------------
-- daily_cash_summary must not become a cross-tenant leak
-- ---------------------------------------------------------------------------
-- It is SECURITY INVOKER on purpose. A definer function here would happily
-- total up another club's takings for anyone who guessed a tenant id, so this
-- asserts the numbers stay empty when pointed at a club the caller is not in.
select pg_temp.act_as(pg_temp.royal_reception());

select isnt(
  (select total_expenses_minor
     from public.daily_cash_summary(pg_temp.royal(), current_date)),
  0::bigint,
  'a member sees their own club''s daily totals');

select is(
  (select total_received_minor
     from public.daily_cash_summary(pg_temp.blue(), current_date)),
  0::bigint,
  'pointing the cash summary at another club returns nothing, not their takings');

select is(
  (select total_expenses_minor
     from public.daily_cash_summary(pg_temp.blue(), current_date)),
  0::bigint,
  'and no spend either');

select is((select count(*)::int from public.cash_closings where tenant_id = pg_temp.blue()), 0,
          'Royal staff see zero Blue Cue cash closings');

-- ---------------------------------------------------------------------------
-- Reporting must not become a cross-tenant leak either
-- ---------------------------------------------------------------------------
-- Every report function is SECURITY INVOKER. If any of them were declared
-- DEFINER, a member of one club could total up another club's takings simply
-- by passing a different tenant id - the arguments are not the security
-- boundary, RLS is. Each assertion below points a report at Blue Cue from a
-- Royal session and expects nothing back.
select pg_temp.act_as(pg_temp.royal_owner());

select is(
  (select collected_minor
     from public.report_revenue_summary(pg_temp.blue(), current_date - 400, current_date)),
  0::bigint,
  'the revenue summary returns nothing for a club the caller is not in');

-- sum() over bigint yields numeric, hence the explicit cast.
select is(
  (select coalesce(sum(collected_minor), 0)::bigint
     from public.report_daily_revenue(pg_temp.blue(), current_date - 30, current_date)),
  0::bigint,
  'the daily trend returns nothing for another club');

select is(
  (select count(*)::int
     from public.report_table_performance(pg_temp.blue(), current_date - 400, current_date)),
  0,
  'table performance lists none of another club''s tables');

select is(
  (select count(*)::int
     from public.report_product_sales(pg_temp.blue(), current_date - 400, current_date)),
  0,
  'product sales lists none of another club''s sales');

select is(
  (select count(*)::int
     from public.report_expense_breakdown(pg_temp.blue(), current_date - 400, current_date)),
  0,
  'the expense breakdown lists none of another club''s spend');

select is(
  (select count(*)::int from public.v_outstanding_sessions where tenant_id = pg_temp.blue()),
  0,
  'outstanding balances leak nothing across clubs');

-- And the same reports do work for the caller's own club, so the assertions
-- above are proving isolation rather than a function that always returns zero.
select isnt(
  (select count(*)::int
     from public.report_table_performance(pg_temp.royal(), current_date - 400, current_date)),
  0,
  'the same report does return the caller''s own tables');

-- ---------------------------------------------------------------------------
-- The platform operator sees across clubs
-- ---------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.platform_admin());
select is((select count(*)::int from public.tenants), 3,
          'the platform super admin sees every club');

select * from finish();
rollback;
