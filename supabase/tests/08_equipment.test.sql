-- ============================================================================
-- Equipment: configured by the owner, flagged by whoever is there
-- ----------------------------------------------------------------------------
-- `public.equipment` had a schema, policies and seed data from migration 0005
-- and no screen. Building one showed the boundary was drawn in the wrong place:
-- every write was owner-only, and the thing that actually happens with a cue is
-- a receptionist picking it up mid-shift and finding the tip gone.
--
-- Migration 0025 splits it along the same line as everything else here:
--
--   configuration  what the club owns, what it cost, retiring it   OWNER
--   operations     what state it is in right now                   ANY STAFF
--
-- RLS cannot say "these columns only", so the second half is a guard trigger.
-- A guard is only as good as its test, which is what this file is: it checks
-- both that a receptionist CAN do the operational thing, and that every
-- configuration column is still refused.
-- ============================================================================
begin;
create extension if not exists pgtap with schema extensions;
\ir _helpers.psql
select plan(22);

-- ---------------------------------------------------------------------------
-- What a receptionist may do
-- ---------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.royal_reception());

select is(
  pg_temp.rows_affected($$update public.equipment set status = 'NEEDS_REPAIR'
                           where name = 'House Cue A'$$),
  1, 'a receptionist can report that a cue needs repair');

select is(
  (select status::text from public.equipment where name = 'House Cue A'),
  'NEEDS_REPAIR', 'and it sticks');

select is(
  pg_temp.rows_affected($$update public.equipment set notes = 'Tip came off mid-frame'
                           where name = 'House Cue A'$$),
  1, 'and can say why');

select is(
  pg_temp.rows_affected($$update public.equipment set status = 'DAMAGED'
                           where name = 'House Cue A'$$),
  1, 'and can escalate it to damaged');

-- ---------------------------------------------------------------------------
-- What a receptionist may not do
-- ---------------------------------------------------------------------------
select throws_ok(
  $$update public.equipment set name = 'Renamed' where name = 'House Cue A'$$,
  '42501', null,
  'a receptionist cannot rename a piece of equipment');

select throws_ok(
  $$update public.equipment set purchase_price_minor = 1 where name = 'House Cue A'$$,
  '42501', null,
  'nor change what it cost');

select throws_ok(
  $$update public.equipment set category = 'FURNITURE' where name = 'House Cue A'$$,
  '42501', null,
  'nor recategorise it');

select throws_ok(
  $$update public.equipment set asset_code = 'FORGED' where name = 'House Cue A'$$,
  '42501', null,
  'nor change its asset code');

select throws_ok(
  format($$update public.equipment
              set assigned_table_id = (select id from public.club_tables where tenant_id = %L limit 1)
            where name = 'House Cue A'$$, pg_temp.royal()),
  '42501', null,
  'nor move it to a table');

-- Retiring is a disposal decision, not an observation about condition.
select throws_ok(
  $$update public.equipment set status = 'RETIRED' where name = 'House Cue A'$$,
  '42501', null,
  'and cannot retire it, which is a decision rather than a condition');

select throws_ok(
  format($$insert into public.equipment (tenant_id, category, name)
           values (%L, 'CUE', 'Smuggled Cue')$$, pg_temp.royal()),
  '42501', null,
  'nor add equipment');

select is(
  pg_temp.rows_affected($$delete from public.equipment where name = 'House Cue A'$$),
  0, 'nor remove any');

-- ---------------------------------------------------------------------------
-- What the owner may do
-- ---------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.royal_owner());

select lives_ok(
  format($$insert into public.equipment (tenant_id, category, name, purchase_price_minor)
           values (%L, 'BALL_SET', 'Tournament Ball Set', 850000)$$, pg_temp.royal()),
  'the owner adds a piece of equipment');

select is(
  pg_temp.rows_affected($$update public.equipment set name = 'Championship Ball Set'
                           where name = 'Tournament Ball Set'$$),
  1, 'and can rename it');

-- `equipment_retired_consistency` requires status and retired_at to agree.
-- The trigger derives one from the other so no caller has to remember both.
select lives_ok(
  $$update public.equipment set status = 'RETIRED' where name = 'Championship Ball Set'$$,
  'and can retire it without touching retired_at');

select isnt(
  (select retired_at from public.equipment where name = 'Championship Ball Set'),
  null, 'retired_at is filled in for them');

select lives_ok(
  $$update public.equipment set status = 'AVAILABLE' where name = 'Championship Ball Set'$$,
  'and can bring it back');

select is(
  (select retired_at from public.equipment where name = 'Championship Ball Set'),
  null, 'which clears retired_at again, so the constraint cannot be tripped');

-- A retired item must not still be shown as sitting on a table.
select lives_ok(
  format($$update public.equipment
              set assigned_table_id = (select id from public.club_tables where tenant_id = %L limit 1)
            where name = 'Championship Ball Set'$$, pg_temp.royal()),
  'the owner assigns it to a table');

select lives_ok(
  $$update public.equipment set status = 'RETIRED' where name = 'Championship Ball Set'$$,
  'then retires it');

select is(
  (select assigned_table_id from public.equipment where name = 'Championship Ball Set'),
  null, 'and the table assignment is dropped, so nothing shows a disposed item in play');

-- ---------------------------------------------------------------------------
-- Isolation
-- ---------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.blue_owner());

select is(
  (select count(*)::int from public.equipment where tenant_id = pg_temp.royal()),
  0, 'another club''s owner sees none of it');

select * from finish();
rollback;
