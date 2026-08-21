-- ============================================================================
-- 0015 · Multi-club ownership, and who owns which decisions
-- ----------------------------------------------------------------------------
-- Two changes, both correcting an assumption rather than adding structure.
--
-- 1. ONE OWNER, MANY CLUBS
--    `tenant_memberships` was already many-to-many, and every RLS policy
--    already asks "is the caller a member of THIS tenant" rather than "what is
--    the caller's tenant". The only thing preventing multi-club ownership was a
--    partial unique index asserting one active membership per user.
--
--    That rule is still right for a receptionist, who works one counter. It was
--    never right for an owner, who may run several clubs on one login. The
--    index is therefore narrowed to receptionists instead of dropped, so the
--    business rule survives while the product model opens up.
--
-- 2. CLUB CONFIGURATION BELONGS TO THE OWNER
--    Tables, pricing, products, equipment, categories and billing rules were
--    writable by `can_manage_tenant`, which includes platform operators. The
--    product model says the platform administers the *customer relationship* -
--    creating clubs, assigning owners, controlling branding - and the owner
--    runs the club. These policies move to `is_tenant_owner`, which has no
--    platform escalation.
--
--    Staff membership deliberately stays on `can_manage_tenant`: the platform
--    has to be able to attach an owner to a club it just created.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. One owner, many clubs
-- ---------------------------------------------------------------------------
drop index if exists public.tenant_memberships_single_active_per_user;

-- A receptionist still works at exactly one club at a time. Owners are
-- unconstrained, which is what makes the ownership tree in docs/architecture.md
-- expressible at all.
create unique index tenant_memberships_single_active_club_for_staff
  on public.tenant_memberships (user_id)
  where status = 'ACTIVE' and role = 'RECEPTIONIST';

comment on index public.tenant_memberships_single_active_club_for_staff is
  'Receptionists work one counter. Owners may hold an active membership in many clubs.';

-- Resolving "every club this user can reach" is now on the hot path of every
-- sign-in, so it gets a covering index rather than relying on the status index.
create index if not exists tenant_memberships_user_active_idx
  on public.tenant_memberships (user_id, tenant_id)
  where status = 'ACTIVE';

-- ---------------------------------------------------------------------------
-- 2. Club configuration is the owner's, not the platform's
-- ---------------------------------------------------------------------------
-- Rewritten rather than added to: each policy is dropped and recreated so the
-- final state is exactly what is written here, with no stale predicate left
-- behind from migration 0009.

do $$
declare
  v_table text;
  v_verb  text;
  v_policy text;
begin
  foreach v_table in array array[
    'club_tables', 'table_types', 'pricing_rules',
    'products', 'product_categories', 'equipment',
    'expense_categories', 'tenant_billing_settings'
  ] loop
    for v_policy, v_verb in
      select p.polname,
             case p.polcmd when 'a' then 'insert' when 'w' then 'update' when 'd' then 'delete' end
      from pg_policy p
      join pg_class c on c.oid = p.polrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = v_table
        and p.polcmd in ('a', 'w', 'd')
    loop
      execute format('drop policy %I on public.%I', v_policy, v_table);
    end loop;

    execute format($f$
      create policy "%1$s: owner inserts"
        on public.%1$I for insert to authenticated
        with check (app.is_tenant_owner(tenant_id))
    $f$, v_table);

    execute format($f$
      create policy "%1$s: owner updates"
        on public.%1$I for update to authenticated
        using (app.is_tenant_owner(tenant_id))
        with check (app.is_tenant_owner(tenant_id))
    $f$, v_table);

    -- Billing settings are 1:1 with a tenant and provisioned by trigger; there
    -- is no legitimate reason for anyone to delete the row.
    if v_table <> 'tenant_billing_settings' then
      execute format($f$
        create policy "%1$s: owner deletes"
          on public.%1$I for delete to authenticated
          using (app.is_tenant_owner(tenant_id))
      $f$, v_table);
    end if;
  end loop;
end;
$$;

comment on table public.club_tables is
  'Physical playing tables. Owner-managed: the platform provisions clubs, the owner configures them.';
