-- ============================================================================
-- Role authorization
-- ----------------------------------------------------------------------------
-- Proves the three-role model actually holds in the database:
--
--   RECEPTIONIST  daily operations only
--   OWNER         + club configuration and staff
--   PLATFORM      + tenants, branding and status; read-only over club books
--
-- Also proves the two properties the product depends on most:
--   * club staff cannot touch platform-controlled branding, and
--   * nobody can escalate their own role.
-- ============================================================================
begin;
create extension if not exists pgtap with schema extensions;
\ir _helpers.psql
select plan(56);

-- ---------------------------------------------------------------------------
-- Receptionist: may operate, may not configure
-- ---------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.royal_reception());

select lives_ok(
  $$insert into public.sessions (tenant_id, table_id, status, started_by)
    select 'aaaaaaaa-0000-4000-8000-000000000001', id, 'ACTIVE',
           '33333333-3333-4333-8333-333333333333'
      from public.club_tables where name = 'Pool 1'$$,
  'receptionist can start a session');

select lives_ok(
  $$insert into public.expenses (tenant_id, amount_minor, expense_date, payment_method, note, created_by)
    values ('aaaaaaaa-0000-4000-8000-000000000001', 25000, current_date, 'CASH', 'Tea for staff',
            '33333333-3333-4333-8333-333333333333')$$,
  'receptionist can record an expense');

select throws_ok(
  $$insert into public.club_tables (tenant_id, table_type_id, name)
    select 'aaaaaaaa-0000-4000-8000-000000000001', id, 'Rogue Table'
      from public.table_types
     where tenant_id = 'aaaaaaaa-0000-4000-8000-000000000001' and code = 'SNOOKER'$$,
  '42501', null,
  'receptionist cannot add a physical table');

select is(
  pg_temp.rows_affected($$update public.pricing_rules set rate_minor = 1$$),
  0, 'receptionist cannot change pricing');

select is(
  pg_temp.rows_affected($$update public.products set selling_price_minor = 1$$),
  0, 'receptionist cannot change product prices');

select is(
  pg_temp.rows_affected($$update public.tenant_billing_settings set grace_period_minutes = 999$$),
  0, 'receptionist cannot change billing rules');

select is((select count(*)::int from public.activity_logs), 0,
          'receptionist cannot read the audit trail');

-- Self-escalation attempts
select is(
  pg_temp.rows_affected(
    $$update public.tenant_memberships set role = 'OWNER'
       where user_id = '33333333-3333-4333-8333-333333333333'$$),
  0, 'receptionist cannot promote themselves to owner');

select throws_ok(
  $$insert into public.platform_admins (user_id, role)
    values ('33333333-3333-4333-8333-333333333333', 'SUPER_ADMIN')$$,
  '42501', null,
  'receptionist cannot make themselves a platform admin');

select throws_ok(
  $$select public.add_tenant_member('aaaaaaaa-0000-4000-8000-000000000001',
                                    'reception@royalsnooker.dev', 'OWNER')$$,
  '42501', null,
  'receptionist cannot use the staff RPC to promote anyone');

-- ---------------------------------------------------------------------------
-- Branding is platform-controlled: neither role in the club can touch it
-- ---------------------------------------------------------------------------
select throws_ok(
  $$update public.tenants set primary_color = '#ff0000'
     where id = 'aaaaaaaa-0000-4000-8000-000000000001'$$,
  '42501', null,
  'receptionist cannot change club branding');

select pg_temp.act_as(pg_temp.royal_owner());

select throws_ok(
  $$update public.tenants set primary_color = '#ff0000', name = 'Renamed Club'
     where id = 'aaaaaaaa-0000-4000-8000-000000000001'$$,
  '42501', null,
  'even the club OWNER cannot change branding');

select throws_ok(
  $$update public.tenants set status = 'ACTIVE'
     where id = 'aaaaaaaa-0000-4000-8000-000000000001'$$,
  '42501', null,
  'the club owner cannot change their own tenant status');

select throws_ok(
  $$insert into public.tenants (slug, name) values ('self-made', 'Self Made Club')$$,
  '42501', null,
  'the club owner cannot create a tenant');

select throws_ok(
  $$select public.platform_create_tenant('Sneaky Club', 'sneaky-club')$$,
  '42501', null,
  'the club owner cannot create a tenant through the platform RPC');

select throws_ok(
  $$select public.platform_update_tenant('aaaaaaaa-0000-4000-8000-000000000001',
                                          p_primary_color => '#ff0000')$$,
  '42501', null,
  'the club owner is refused by the branding RPC itself');

select throws_ok(
  $$select public.platform_set_tenant_status('aaaaaaaa-0000-4000-8000-000000000001', 'SUSPENDED')$$,
  '42501', null,
  'the club owner cannot change their own tenant status through the RPC');

-- ---------------------------------------------------------------------------
-- Owner: may configure their own club, and only their own
-- ---------------------------------------------------------------------------
select lives_ok(
  $$insert into public.club_tables (tenant_id, table_type_id, name)
    select 'aaaaaaaa-0000-4000-8000-000000000001', id, 'Snooker 3'
      from public.table_types
     where tenant_id = 'aaaaaaaa-0000-4000-8000-000000000001' and code = 'SNOOKER'$$,
  'owner can add a physical table');

select is(
  pg_temp.rows_affected($$update public.tenant_billing_settings set grace_period_minutes = 10$$),
  1, 'owner can change their own billing rules');

select isnt((select count(*)::int from public.activity_logs), 0,
            'owner can read the audit trail');

select throws_ok(
  $$select public.add_tenant_member('bbbbbbbb-0000-4000-8000-000000000002',
                                    'owner@bluecue.dev', 'OWNER')$$,
  '42501', null,
  'owner cannot add staff to another club');

select lives_ok(
  $$select public.add_tenant_member('aaaaaaaa-0000-4000-8000-000000000001',
                                    'reception@royalsnooker.dev', 'RECEPTIONIST')$$,
  'owner can manage staff in their own club');

-- ---------------------------------------------------------------------------
-- Append-only tables are protected by GRANTs, not only by policy
-- ---------------------------------------------------------------------------
select throws_ok($$update public.inventory_movements set quantity_delta = 0$$, '42501', null,
                 'the stock ledger cannot be edited');
select throws_ok($$delete from public.inventory_movements$$, '42501', null,
                 'the stock ledger cannot be deleted from');
select throws_ok($$update public.activity_logs set action = 'tampered'$$, '42501', null,
                 'the audit trail cannot be edited');
select throws_ok($$delete from public.activity_logs$$, '42501', null,
                 'the audit trail cannot be deleted from');

-- ---------------------------------------------------------------------------
-- Notifications: a recipient may mark read, not rewrite
-- ---------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.royal_reception());
select lives_ok(
  $$update public.notifications set read_at = now() where recipient_user_id is null$$,
  'a member can mark a broadcast notification read');
select throws_ok(
  $$update public.notifications set title = 'rewritten' where recipient_user_id is null$$,
  '42501', null,
  'a member cannot rewrite the notification itself');

-- ---------------------------------------------------------------------------
-- Platform operator: administers clubs, does not edit their books
-- ---------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.platform_admin());

-- Even the platform admin has no direct UPDATE on `tenants`; branding is
-- changed through the SECURITY DEFINER RPC, which re-checks their authority.
select throws_ok(
  $$update public.tenants set primary_color = '#7C3AED'
     where id = 'aaaaaaaa-0000-4000-8000-000000000001'$$,
  '42501', null,
  'not even the platform admin can UPDATE public.tenants directly');

select lives_ok(
  $$select public.platform_update_tenant(
      'aaaaaaaa-0000-4000-8000-000000000001',
      p_primary_color => '#7C3AED',
      p_logo_url      => 'https://cdn.example/logo.png')$$,
  'the platform super admin can set club branding through the RPC');

select is(
  (select primary_color from public.tenants where id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  '#7C3AED', 'and the branding change actually landed');

select lives_ok(
  $$select public.platform_set_tenant_status('aaaaaaaa-0000-4000-8000-000000000001', 'ACTIVE')$$,
  'the platform super admin can set tenant status through the RPC');

select lives_ok(
  $$select public.platform_create_tenant('Test Cue Club', 'test-cue-club')$$,
  'the platform super admin can create a tenant');

select is((select count(*)::int from public.table_types t
            join public.tenants tn on tn.id = t.tenant_id
           where tn.slug = 'test-cue-club'),
          3, 'a new tenant is provisioned with the three default table types');

select is((select count(*)::int from public.expense_categories ec
            join public.tenants tn on tn.id = ec.tenant_id
           where tn.slug = 'test-cue-club'),
          8, 'a new tenant is provisioned with the eight default expense categories');

select is((select count(*)::int from public.tenant_billing_settings bs
            join public.tenants tn on tn.id = bs.tenant_id
           where tn.slug = 'test-cue-club'),
          1, 'a new tenant is provisioned with billing settings');

select is(
  pg_temp.rows_affected($$update public.sessions set notes = 'platform edit'$$),
  0, 'the platform admin cannot edit a club''s sessions');

select is(
  pg_temp.rows_affected($$update public.expenses set amount_minor = 1$$),
  0, 'the platform admin cannot edit a club''s expenses');

-- ---------------------------------------------------------------------------
-- Account state: a disabled user is locked out and cannot let themselves back in
-- ---------------------------------------------------------------------------
select pg_temp.act_as_system();
update public.profiles set is_active = false where id = pg_temp.blue_reception();

select pg_temp.act_as(pg_temp.blue_reception());
select is((select count(*)::int from public.club_tables), 0,
          'a disabled account can no longer read club data');
select throws_ok(
  $$update public.profiles set is_active = true
     where id = '55555555-5555-4555-8555-555555555555'$$,
  '42501', null,
  'a disabled account cannot re-enable itself');

-- ---------------------------------------------------------------------------
-- Tenant suspension revokes data access but keeps the club row readable, so the
-- app can render a "suspended" screen instead of an empty one.
-- ---------------------------------------------------------------------------
select pg_temp.act_as_system();
update public.tenants set status = 'SUSPENDED' where id = pg_temp.blue();

select pg_temp.act_as(pg_temp.blue_owner());
select is((select count(*)::int from public.tenants where id = pg_temp.blue()), 1,
          'a suspended club can still be read by its owner');
select is((select count(*)::int from public.club_tables), 0,
          'a suspended club exposes no operational data');
select is((select app.get_user_tenant_id()), null,
          'a suspended club resolves to no active tenant');

-- ---------------------------------------------------------------------------
-- Club configuration is owner-only; daily operations are not
-- ---------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.royal_reception());

select throws_ok(
  $$insert into public.products (tenant_id, name, selling_price_minor)
    values ('aaaaaaaa-0000-4000-8000-000000000001', 'Rogue Item', 100)$$,
  '42501', null,
  'receptionist cannot add a product to the catalogue');

select is(
  pg_temp.rows_affected($$update public.products set stock_quantity = 9999$$),
  0, 'receptionist cannot overwrite a stock count directly');

-- But posting to the ledger IS a daily operation - that is how stock moves.
select lives_ok(
  $$insert into public.inventory_movements (tenant_id, product_id, movement_type, quantity_delta)
    select 'aaaaaaaa-0000-4000-8000-000000000001', id, 'ADJUSTMENT', -1
      from public.products
     where tenant_id = 'aaaaaaaa-0000-4000-8000-000000000001' limit 1$$,
  'receptionist can post a stock movement');

select lives_ok(
  $$insert into public.cash_closings (tenant_id, business_date, opening_cash_minor, opened_by)
    values ('aaaaaaaa-0000-4000-8000-000000000001', current_date - 30, 100000,
            '33333333-3333-4333-8333-333333333333')$$,
  'receptionist can open the till - it is a daily operation');

select pg_temp.act_as(pg_temp.royal_owner());

select lives_ok(
  $$insert into public.products (tenant_id, name, selling_price_minor)
    values ('aaaaaaaa-0000-4000-8000-000000000001', 'Owner Added Item', 4200)$$,
  'owner can add a product');

select is(
  pg_temp.rows_affected(
    $$update public.pricing_rules set rate_minor = 12345
       where tenant_id = 'aaaaaaaa-0000-4000-8000-000000000001' and is_default$$),
  3, 'owner can change their own pricing');

-- ---------------------------------------------------------------------------
-- Table privileges are exactly what PostgREST needs and nothing more.
-- TRUNCATE in particular ignores RLS, so it must not be reachable by a client.
-- ---------------------------------------------------------------------------
select pg_temp.act_as_system();

select table_privs_are('public', 'sessions', 'authenticated',
  array['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  'authenticated holds only CRUD on sessions - no TRUNCATE, TRIGGER or REFERENCES');

select table_privs_are('public', 'tenants', 'authenticated', array['SELECT'],
  'authenticated can only read tenants');

select table_privs_are('public', 'inventory_movements', 'authenticated',
  array['SELECT', 'INSERT'],
  'the stock ledger is append-only at the privilege level');

select table_privs_are('public', 'activity_logs', 'authenticated',
  array['SELECT', 'INSERT'],
  'the audit trail is append-only at the privilege level');

select table_privs_are('public', 'sessions', 'anon', array[]::text[],
  'anon holds no privilege on sessions at all');

select table_privs_are('public', 'tenants', 'anon', array[]::text[],
  'anon holds no privilege on tenants at all');

select pg_temp.act_as(pg_temp.royal_owner());
select throws_ok($$truncate public.sessions$$, '42501', null,
                 'a club owner cannot TRUNCATE their way around RLS');

select * from finish();
rollback;
