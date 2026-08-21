-- ============================================================================
-- Multi-club ownership
-- ----------------------------------------------------------------------------
-- The product's shape is PLATFORM -> OWNER -> CLUB -> staff, where one owner
-- may run any number of clubs from a single login while a receptionist works at
-- exactly one.
--
-- Every assertion below runs as the `authenticated` role. That matters: as
-- `postgres` (BYPASSRLS) all of these would pass regardless of whether a single
-- policy were correct, and the suite would prove nothing.
--
-- The eleven properties being pinned down:
--
--    1  an owner can hold active memberships in several clubs
--    2  a receptionist cannot be active at two clubs at once
--    3  a multi-club owner reads data from every club they own
--    4  ... and nothing from a club they do not own
--    5  a receptionist reads only their own club
--    6  a cross-club write matches nothing rather than erroring
--    7  an owner cannot configure a club they do not own
--    8  ownership can only be granted by the platform
--    9  suspending one club leaves the owner's other clubs untouched
--   10  disabling an owner's account revokes every club at once
--   11  an owner keeps their own club's books away from other owners
-- ============================================================================
begin;
create extension if not exists pgtap with schema extensions;
\ir _helpers.psql
select plan(38);

-- ---------------------------------------------------------------------------
-- 1 · One owner, several clubs
-- ---------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.royal_owner());

select is(
  (select count(*)::int from app.tenant_ids()),
  2, 'the Royal owner reaches two clubs');

select set_has(
  $$select tid from app.tenant_ids() as tid$$,
  $$values ('aaaaaaaa-0000-4000-8000-000000000001'::uuid),
           ('cccccccc-0000-4000-8000-000000000003'::uuid)$$,
  'and they are Royal Snooker and Cue Lounge');

-- The single-club helper must refuse to guess for them.
select is(app.get_user_tenant_id(), null,
  'get_user_tenant_id returns NULL rather than picking one of the two');

select pg_temp.act_as(pg_temp.blue_owner());
select is(app.get_user_tenant_id(), pg_temp.blue(),
  'a single-club owner still resolves unambiguously');

-- ---------------------------------------------------------------------------
-- 2 · A receptionist works at one club
-- ---------------------------------------------------------------------------
select pg_temp.act_as_system();

select throws_ok(
  format($$insert into public.tenant_memberships (tenant_id, user_id, role, status)
           values (%L, %L, 'RECEPTIONIST', 'ACTIVE')$$,
         pg_temp.blue(), pg_temp.royal_reception()),
  '23505', null,
  'a second active receptionist membership is refused by the partial unique index');

select lives_ok(
  format($$insert into public.tenant_memberships (tenant_id, user_id, role, status)
           values (%L, %L, 'RECEPTIONIST', 'DISABLED')$$,
         pg_temp.blue(), pg_temp.royal_reception()),
  'but a disabled one is allowed, so a move between clubs is possible');

select lives_ok(
  format($$insert into public.tenant_memberships (tenant_id, user_id, role, status)
           values (%L, %L, 'OWNER', 'ACTIVE')$$,
         pg_temp.blue(), pg_temp.royal_owner()),
  'and the same index does not constrain owners');

-- Leave the fixture as it was for the reads below.
select is(
  pg_temp.rows_affected(format(
    $$delete from public.tenant_memberships
       where tenant_id = %L and user_id in (%L, %L)$$,
    pg_temp.blue(), pg_temp.royal_reception(), pg_temp.royal_owner())),
  2, 'the two extra memberships are cleaned up before the read assertions');

-- ---------------------------------------------------------------------------
-- 3 · A multi-club owner reads all of their clubs
-- ---------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.royal_owner());

select ok(
  (select count(*) from public.club_tables where tenant_id = pg_temp.royal()) > 0,
  'the owner sees their first club''s tables');

select ok(
  (select count(*) from public.club_tables where tenant_id = pg_temp.lounge()) > 0,
  'and their second club''s tables');

select is(
  (select count(distinct tenant_id)::int from public.club_tables),
  2, 'an unfiltered read returns exactly their two clubs, no more');

select is(
  (select count(distinct tenant_id)::int from public.pricing_rules),
  2, 'the same holds for pricing rules');

select is(
  (select count(distinct tenant_id)::int from public.tenant_billing_settings),
  2, 'and for billing settings, which differ per club');

-- Each club keeps its own rules; the owner is not shown one merged view.
select isnt(
  (select time_calculation_mode::text from public.tenant_billing_settings
    where tenant_id = pg_temp.royal()),
  (select time_calculation_mode::text from public.tenant_billing_settings
    where tenant_id = pg_temp.lounge()),
  'the two clubs bill differently and both are visible as themselves');

-- ---------------------------------------------------------------------------
-- 4 · ... and nothing from a club they do not own
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from public.club_tables where tenant_id = pg_temp.blue()),
  0, 'the Royal owner cannot see the Blue Cue club''s tables');

select is(
  (select count(*)::int from public.sessions where tenant_id = pg_temp.blue()),
  0, 'nor its sessions');

select is(
  (select count(*)::int from public.expenses where tenant_id = pg_temp.blue()),
  0, 'nor its expenses');

-- ---------------------------------------------------------------------------
-- 5 · A receptionist reads only their own club
-- ---------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.royal_reception());

select is(
  (select count(distinct tenant_id)::int from public.club_tables),
  1, 'a receptionist sees exactly one club''s tables');

select is(
  (select count(*)::int from public.club_tables where tenant_id = pg_temp.lounge()),
  0, 'and not the second club their owner also runs');

-- ---------------------------------------------------------------------------
-- 6 · Cross-club writes match nothing
-- ---------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.royal_owner());

select is(
  pg_temp.rows_affected(format(
    $$update public.club_tables set name = 'Hijacked' where tenant_id = %L$$, pg_temp.blue())),
  0, 'an update aimed at another owner''s club touches no rows');

select is(
  pg_temp.rows_affected(format(
    $$delete from public.pricing_rules where tenant_id = %L$$, pg_temp.blue())),
  0, 'so does a delete');

select throws_ok(
  format($$insert into public.club_tables (tenant_id, table_type_id, name)
           select %L, id, 'Smuggled' from public.table_types limit 1$$, pg_temp.blue()),
  '42501', null,
  'and an insert into another owner''s club is refused outright');

-- ---------------------------------------------------------------------------
-- 7 · An owner configures only their own clubs
-- ---------------------------------------------------------------------------
select isnt(
  pg_temp.rows_affected(format(
    $$update public.tenant_billing_settings set grace_period_minutes = 7 where tenant_id = %L$$,
    pg_temp.lounge())),
  0, 'the owner can change billing rules in their second club');

select is(
  pg_temp.rows_affected(format(
    $$update public.tenant_billing_settings set grace_period_minutes = 7 where tenant_id = %L$$,
    pg_temp.blue())),
  0, 'but not in a club belonging to somebody else');

-- The platform administers clubs; it does not run them.
select pg_temp.act_as(pg_temp.platform_admin());

select is(
  pg_temp.rows_affected(format(
    $$update public.tenant_billing_settings set grace_period_minutes = 99 where tenant_id = %L$$,
    pg_temp.royal())),
  0, 'and neither can the platform administrator - billing is the club''s own decision');

select is(
  pg_temp.rows_affected($$update public.club_tables set name = 'Platform Table'$$),
  0, 'the platform cannot rearrange a club''s tables either');

-- ---------------------------------------------------------------------------
-- 8 · Only the platform grants ownership
-- ---------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.royal_owner());

select throws_ok(
  format($$select public.add_tenant_member(%L, 'reception@royalsnooker.dev', 'OWNER')$$,
         pg_temp.royal()),
  '42501', null,
  'an owner cannot promote somebody to owner of their own club');

select pg_temp.act_as(pg_temp.platform_admin());

select lives_ok(
  format($$select public.platform_assign_owner(%L, 'owner@bluecue.dev', false)$$, pg_temp.lounge()),
  'the platform can add a second owner to a club');

select is(
  (select count(*)::int from public.tenant_memberships
    where tenant_id = pg_temp.lounge() and role = 'OWNER' and status = 'ACTIVE'),
  2, 'and the original owner keeps their membership when not replacing');

-- ---------------------------------------------------------------------------
-- 9 · Suspending one club leaves the others alone
-- ---------------------------------------------------------------------------
select lives_ok(
  format($$select public.platform_set_tenant_status(%L, 'SUSPENDED')$$, pg_temp.lounge()),
  'the platform suspends one of the owner''s clubs');

select pg_temp.act_as(pg_temp.royal_owner());

select is(
  (select count(*)::int from app.tenant_ids()),
  1, 'the owner now reaches one club rather than two');

select ok(
  (select count(*) from public.club_tables where tenant_id = pg_temp.royal()) > 0,
  'their remaining club is entirely unaffected');

select is(
  (select count(*)::int from public.club_tables where tenant_id = pg_temp.lounge()),
  0, 'and the suspended club is invisible even to its own owner');

-- ---------------------------------------------------------------------------
-- 10 · Disabling an owner revokes every club at once
-- ---------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.platform_admin());

select lives_ok(
  format($$select public.platform_set_tenant_status(%L, 'ACTIVE')$$, pg_temp.lounge()),
  'the suspended club is brought back so the next case is not confounded by it');

select lives_ok(
  format($$select public.platform_set_owner_active(%L, false)$$, pg_temp.royal_owner()),
  'the platform disables the owner''s account');

select pg_temp.act_as(pg_temp.royal_owner());

select is(
  (select count(*)::int from app.tenant_ids()),
  0, 'a disabled owner reaches none of their clubs');

select is(
  (select count(*)::int from public.club_tables),
  0, 'and reads nothing, in either club');

-- ---------------------------------------------------------------------------
-- 11 · The books stay with the club that earned them
-- ---------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.blue_owner());

select is(
  (select count(*)::int from public.sessions where tenant_id = pg_temp.royal()),
  0, 'one owner cannot read another owner''s takings');

select * from finish();
rollback;
