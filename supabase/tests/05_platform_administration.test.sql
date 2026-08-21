-- ============================================================================
-- Platform administration and club staffing
-- ----------------------------------------------------------------------------
-- The RPCs behind the platform screens and the owner's staff screen. Two
-- separate questions are being asked of each one:
--
--   who is allowed to call it            (authorization)
--   what it refuses even when allowed    (invariants)
--
-- The second matters most here. `set_membership_status` is SECURITY DEFINER
-- precisely because it enforces two rules RLS cannot express - a club must keep
-- an owner, and nobody may revoke their own access - and a SECURITY DEFINER
-- function whose guards are untested is a privilege escalation waiting to
-- happen.
-- ============================================================================
begin;
create extension if not exists pgtap with schema extensions;
\ir _helpers.psql
select plan(27);

-- ---------------------------------------------------------------------------
-- Platform reads are for the platform
-- ---------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.platform_admin());

select isnt((select count(*)::int from public.platform_overview()), 0,
  'the platform administrator gets the dashboard counts');
select is((select clubs_count from public.platform_overview()), 3,
  'and the count covers every club');
select is((select count(*)::int from public.platform_owners()), 2,
  'the owner directory lists both owners');
select is(
  (select clubs_count from public.platform_owners() where email = 'owner@royalsnooker.dev'),
  2, 'and shows that one of them runs two clubs');
select is((select count(*)::int from public.platform_clubs()), 3,
  'the club list covers every club');
select is(
  (select count(*)::int from public.platform_clubs() where owner_user_id is null),
  0, 'and every club in the fixture has an owner');

select pg_temp.act_as(pg_temp.royal_owner());

select is((select count(*)::int from public.platform_owners()), 0,
  'a club owner gets nothing from the owner directory');
select is((select count(*)::int from public.platform_clubs()), 0,
  'nor from the platform club list');
select is((select count(*)::int from public.platform_overview()), 0,
  'nor from the platform dashboard');

select pg_temp.act_as(pg_temp.royal_reception());

select is((select count(*)::int from public.platform_owners()), 0,
  'and neither does a receptionist');

-- ---------------------------------------------------------------------------
-- Creating a club
-- ---------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.royal_owner());

select throws_ok(
  $$select public.platform_create_club('Rogue Club', 'rogue-club', 'owner@royalsnooker.dev')$$,
  '42501', null,
  'an owner cannot create a club for themselves');

select pg_temp.act_as(pg_temp.platform_admin());

select throws_ok(
  $$select public.platform_create_club('Ghost Club', 'ghost-club', 'nobody@nowhere.dev')$$,
  'P0002', null,
  'creating a club for an address with no account is refused, not silently ownerless');

-- Named arguments, not positional: the function takes sixteen parameters and
-- the fourth is a colour, not a status.
select lives_ok(
  $$select public.platform_create_club(
      p_name => 'Third Club',
      p_slug => 'third-club',
      p_owner_email => 'owner@bluecue.dev',
      p_status => 'ACTIVE')$$,
  'the platform creates a club and hands it to an existing owner');

select is(
  (select count(*)::int from public.tenant_memberships m
     join public.tenants t on t.id = m.tenant_id
    where t.slug = 'third-club' and m.role = 'OWNER' and m.status = 'ACTIVE'),
  1, 'the owner membership is created in the same transaction');

-- The provisioning trigger must have run, or the club would exist but be unusable.
select is(
  (select count(*)::int from public.tenant_billing_settings s
     join public.tenants t on t.id = s.tenant_id
    where t.slug = 'third-club'),
  1, 'and the club is provisioned with billing settings');

select isnt(
  (select count(*)::int from public.table_types tt
     join public.tenants t on t.id = tt.tenant_id
    where t.slug = 'third-club'),
  0, 'and with default table types');

-- ---------------------------------------------------------------------------
-- Staffing a club
-- ---------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.royal_owner());

select is((select count(*)::int from public.tenant_staff(pg_temp.royal())), 2,
  'the owner sees their club''s roster');

select is((select count(*)::int from public.tenant_staff(pg_temp.blue())), 0,
  'and nothing of another owner''s roster');

select throws_ok(
  format($$select public.set_membership_status(
             (select id from public.tenant_memberships
               where tenant_id = %L and user_id = %L), 'DISABLED')$$,
         pg_temp.royal(), pg_temp.royal_owner()),
  '42501', null,
  'an owner cannot revoke their own access');

-- P0002, not 42501: the owner cannot even *see* the membership row to name it,
-- because the select policy on tenant_memberships already hid it. The
-- authorization check further in would have refused too.
select throws_ok(
  format($$select public.set_membership_status(
             (select id from public.tenant_memberships
               where tenant_id = %L and user_id = %L), 'DISABLED')$$,
         pg_temp.blue(), pg_temp.blue_reception()),
  'P0002', null,
  'nor touch staff at a club they do not own - the row is not even visible to name');

select lives_ok(
  format($$select public.set_membership_status(
             (select id from public.tenant_memberships
               where tenant_id = %L and user_id = %L), 'DISABLED')$$,
         pg_temp.royal(), pg_temp.royal_reception()),
  'but can revoke their own receptionist''s access');

-- Revoking is what actually ends access, not a UI decision.
select pg_temp.act_as(pg_temp.royal_reception());

select is((select count(*)::int from app.tenant_ids()), 0,
  'that receptionist immediately reaches no club');

select is((select count(*)::int from public.club_tables), 0,
  'and reads nothing');

-- ---------------------------------------------------------------------------
-- The last owner cannot be removed
-- ---------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.platform_admin());

select throws_ok(
  format($$select public.set_membership_status(
             (select id from public.tenant_memberships
               where tenant_id = %L and role = 'OWNER' and status = 'ACTIVE' limit 1),
             'DISABLED')$$, pg_temp.blue()),
  '23514', null,
  'a club cannot be left without an active owner');

-- ---------------------------------------------------------------------------
-- The audit trail is written by staff and read by owners
-- ---------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.blue_reception());

select lives_ok(
  format($$select public.log_activity('test.event', %L, 'club_table', null, 'a receptionist did something')$$,
         pg_temp.blue()),
  'a receptionist can append to their own club''s trail');

select throws_ok(
  format($$select public.log_activity('test.event', %L, null, null, 'wrong club')$$, pg_temp.royal()),
  '42501', null,
  'but not to another club''s');

select is((select count(*)::int from public.tenant_activity(pg_temp.blue(), 50)), 0,
  'and cannot read back what they wrote - the trail is theirs to fill, not to audit');

select * from finish();
rollback;
