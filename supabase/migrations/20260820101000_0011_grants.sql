-- ============================================================================
-- 0011 · Privileges
-- ----------------------------------------------------------------------------
-- RLS decides WHICH ROWS a user may touch. Grants decide whether the operation
-- is available at all. Both are used, so a mistake in one layer is not enough
-- to open a hole:
--
--   * `anon` gets nothing. Nothing in this product is public.
--   * `authenticated` gets the CRUD surface; RLS narrows it to their tenant.
--   * Append-only tables have UPDATE/DELETE removed entirely, so no future
--     policy can accidentally re-enable rewriting the ledger or the audit log.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Start from zero for both client roles.
--
-- This revoke is not ceremonial. Supabase's stock default privileges grant ALL
-- on new tables in `public` to anon and authenticated, and ALL includes
-- TRUNCATE - which ignores row level security completely. A logged-in
-- receptionist holding TRUNCATE on public.sessions could erase every club's
-- history in one statement, RLS notwithstanding. It also includes TRIGGER and
-- REFERENCES, neither of which any client needs.
--
-- So: strip everything, then hand back exactly the four verbs PostgREST uses.
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon;
revoke all on all routines in schema public from anon;

-- ---------------------------------------------------------------------------
-- The authenticated surface.
-- ---------------------------------------------------------------------------
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- Read models are read-only.
revoke insert, update, delete on public.v_club_table_overview from authenticated;
revoke insert, update, delete on public.v_low_stock_products   from authenticated;

-- Append-only: the stock ledger and the audit trail may be written, never edited.
revoke update, delete on public.inventory_movements from authenticated;
revoke update, delete on public.activity_logs       from authenticated;

-- `tenants` is platform-controlled and therefore not writable by ANY client
-- role - the platform super admin is an authenticated user too. Branding,
-- status and configuration change only through the SECURITY DEFINER RPCs
-- declared in migration 0010, each of which re-checks app.is_platform_admin().
-- This makes "club staff cannot edit branding" a property of the privilege
-- system rather than of one policy being written correctly.
revoke insert, update, delete on public.tenants from authenticated;

-- ---------------------------------------------------------------------------
-- Authorization helpers
-- ---------------------------------------------------------------------------
-- Policy expressions are evaluated with the caller's privileges, so
-- `authenticated` needs EXECUTE on the helpers. The `app` schema is not in the
-- PostgREST exposed-schema list, so these remain unreachable over the API.
grant usage on schema app to authenticated;
grant execute on all functions in schema app to authenticated;
revoke all on schema app from anon;
revoke all on all functions in schema app from anon;

-- Client-callable RPCs.
grant execute on function public.is_platform_admin()   to authenticated;
grant execute on function public.get_user_tenant_id()  to authenticated;
grant execute on function public.add_tenant_member(uuid, text, public.tenant_role) to authenticated;
grant execute on function public.platform_create_tenant(text, text, text, text, char, text, public.tenant_status)
  to authenticated;
grant execute on function public.platform_update_tenant(uuid, text, text, text, text, text, char, text, text, text, text)
  to authenticated;
grant execute on function public.platform_set_tenant_status(uuid, public.tenant_status) to authenticated;

-- ---------------------------------------------------------------------------
-- Future objects inherit the same shape.
-- ---------------------------------------------------------------------------
-- Replaces Supabase's stock "GRANT ALL to anon, authenticated" default so a
-- table added by a later migration cannot silently reintroduce TRUNCATE.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public grant usage, select on sequences to authenticated;
