-- ============================================================================
-- 0009 · Row Level Security policies
-- ----------------------------------------------------------------------------
-- This file is the security boundary of the product. The mobile app is treated
-- as hostile: it never supplies a tenant_id or a role that is trusted, and
-- hiding a button is never authorization.
--
-- Reading the matrix:
--
--   can_read_tenant     active member of the club, or any platform operator
--   can_operate_tenant  OWNER or RECEPTIONIST  (daily operations)
--   can_manage_tenant   OWNER, or a platform operator (club configuration)
--   is_tenant_owner     OWNER only, no platform escalation
--
-- Platform operators are intentionally read-only over transactional data
-- (sessions, items, expenses, cash, inventory): they administer clubs, they do
-- not quietly edit a club's books.
--
-- Two structural guarantees sit underneath these policies:
--   1. Composite foreign keys `(tenant_id, parent_id)` make a cross-tenant row
--      reference impossible even if a policy is wrong.
--   2. Append-only tables have UPDATE/DELETE revoked at the GRANT level in
--      migration 0011, so a missing policy is not the only thing stopping a
--      rewrite of history.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create policy "profiles: read self, colleagues and platform"
  on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or app.is_platform_admin()
    or app.shares_tenant_with(id)
  );

-- Safety valve: the auth.users trigger normally creates this row.
create policy "profiles: insert own row"
  on public.profiles for insert to authenticated
  with check (id = (select auth.uid()));

create policy "profiles: update own row or platform"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()) or app.is_platform_admin())
  with check (id = (select auth.uid()) or app.is_platform_admin());

create policy "profiles: platform may delete"
  on public.profiles for delete to authenticated
  using (app.is_platform_admin());

-- A user may edit their own name/phone/avatar, but `is_active` and `email` are
-- account-state columns. Without this guard a disabled user could simply flip
-- their own `is_active` back to true and walk straight back in.
create or replace function app.profiles_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Trusted server-side callers (service role, migrations) have no end-user
  -- identity; they are not what this guard is defending against.
  if (select auth.uid()) is null or app.is_platform_admin() then
    return new;
  end if;
  if new.is_active is distinct from old.is_active then
    raise exception 'account status is managed by the platform'
      using errcode = '42501';
  end if;
  if new.email is distinct from old.email then
    raise exception 'email is managed through authentication, not the profile'
      using errcode = '42501';
  end if;
  if new.id is distinct from old.id then
    raise exception 'profile id is immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger profiles_guard
  before update on public.profiles
  for each row execute function app.profiles_guard();

-- ---------------------------------------------------------------------------
-- platform_admins
-- ---------------------------------------------------------------------------
create policy "platform_admins: read self or platform"
  on public.platform_admins for select to authenticated
  using (user_id = (select auth.uid()) or app.is_platform_admin());

-- Only a SUPER_ADMIN may grant platform authority, so a SUPPORT operator
-- cannot promote themselves.
create policy "platform_admins: super admin manages"
  on public.platform_admins for insert to authenticated
  with check (app.has_platform_role('SUPER_ADMIN'));

create policy "platform_admins: super admin updates"
  on public.platform_admins for update to authenticated
  using (app.has_platform_role('SUPER_ADMIN'))
  with check (app.has_platform_role('SUPER_ADMIN'));

create policy "platform_admins: super admin deletes"
  on public.platform_admins for delete to authenticated
  using (app.has_platform_role('SUPER_ADMIN'));

-- ---------------------------------------------------------------------------
-- tenants — read-only for club staff, writable only by the platform
-- ---------------------------------------------------------------------------
-- There is deliberately NO insert/update/delete policy for tenant users. That
-- is what makes club name, logo, colours, currency, timezone and status
-- platform-controlled: not a hidden button, an absent policy.
create policy "tenants: members read their own club"
  on public.tenants for select to authenticated
  using (app.is_platform_admin() or app.has_tenant_membership(id));

-- There is no INSERT/UPDATE/DELETE policy on `tenants` for anybody, and
-- migration 0011 additionally revokes those privileges from `authenticated`.
-- The platform super admin is an authenticated user like everyone else, so
-- they do not get a write path here either: branding, status and configuration
-- are changed only through the SECURITY DEFINER RPCs in migration 0010
-- (platform_create_tenant / platform_update_tenant / platform_set_tenant_status),
-- each of which re-checks app.is_platform_admin() itself.
--
-- The practical effect: no future policy mistake can hand club staff a way to
-- rewrite their own branding, because the privilege does not exist on the role.

-- ---------------------------------------------------------------------------
-- tenant_memberships
-- ---------------------------------------------------------------------------
create policy "memberships: read own and colleagues"
  on public.tenant_memberships for select to authenticated
  using (user_id = (select auth.uid()) or app.can_read_tenant(tenant_id));

create policy "memberships: owner or platform adds staff"
  on public.tenant_memberships for insert to authenticated
  with check (app.can_manage_tenant(tenant_id));

create policy "memberships: owner or platform updates staff"
  on public.tenant_memberships for update to authenticated
  using (app.can_manage_tenant(tenant_id))
  with check (app.can_manage_tenant(tenant_id));

create policy "memberships: owner or platform removes staff"
  on public.tenant_memberships for delete to authenticated
  using (app.can_manage_tenant(tenant_id));

-- ---------------------------------------------------------------------------
-- Club configuration: billing settings, table types, tables, pricing
-- ---------------------------------------------------------------------------
create policy "billing settings: members read"
  on public.tenant_billing_settings for select to authenticated
  using (app.can_read_tenant(tenant_id));

create policy "billing settings: owner or platform writes"
  on public.tenant_billing_settings for insert to authenticated
  with check (app.can_manage_tenant(tenant_id));

create policy "billing settings: owner or platform updates"
  on public.tenant_billing_settings for update to authenticated
  using (app.can_manage_tenant(tenant_id))
  with check (app.can_manage_tenant(tenant_id));

create policy "billing settings: platform deletes"
  on public.tenant_billing_settings for delete to authenticated
  using (app.is_platform_admin());

create policy "table types: members read"
  on public.table_types for select to authenticated
  using (app.can_read_tenant(tenant_id));

create policy "table types: owner or platform inserts"
  on public.table_types for insert to authenticated
  with check (app.can_manage_tenant(tenant_id));

create policy "table types: owner or platform updates"
  on public.table_types for update to authenticated
  using (app.can_manage_tenant(tenant_id))
  with check (app.can_manage_tenant(tenant_id));

create policy "table types: owner or platform deletes"
  on public.table_types for delete to authenticated
  using (app.can_manage_tenant(tenant_id));

create policy "club tables: members read"
  on public.club_tables for select to authenticated
  using (app.can_read_tenant(tenant_id));

create policy "club tables: owner or platform inserts"
  on public.club_tables for insert to authenticated
  with check (app.can_manage_tenant(tenant_id));

create policy "club tables: owner or platform updates"
  on public.club_tables for update to authenticated
  using (app.can_manage_tenant(tenant_id))
  with check (app.can_manage_tenant(tenant_id));

create policy "club tables: owner or platform deletes"
  on public.club_tables for delete to authenticated
  using (app.can_manage_tenant(tenant_id));

create policy "pricing rules: members read"
  on public.pricing_rules for select to authenticated
  using (app.can_read_tenant(tenant_id));

create policy "pricing rules: owner or platform inserts"
  on public.pricing_rules for insert to authenticated
  with check (app.can_manage_tenant(tenant_id));

create policy "pricing rules: owner or platform updates"
  on public.pricing_rules for update to authenticated
  using (app.can_manage_tenant(tenant_id))
  with check (app.can_manage_tenant(tenant_id));

create policy "pricing rules: owner or platform deletes"
  on public.pricing_rules for delete to authenticated
  using (app.can_manage_tenant(tenant_id));

-- ---------------------------------------------------------------------------
-- Catalogue: product categories, products, equipment
-- ---------------------------------------------------------------------------
create policy "product categories: members read"
  on public.product_categories for select to authenticated
  using (app.can_read_tenant(tenant_id));

create policy "product categories: owner or platform inserts"
  on public.product_categories for insert to authenticated
  with check (app.can_manage_tenant(tenant_id));

create policy "product categories: owner or platform updates"
  on public.product_categories for update to authenticated
  using (app.can_manage_tenant(tenant_id))
  with check (app.can_manage_tenant(tenant_id));

create policy "product categories: owner or platform deletes"
  on public.product_categories for delete to authenticated
  using (app.can_manage_tenant(tenant_id));

-- Receptionists read the catalogue in order to sell from it; only owners may
-- change what a product is or costs.
create policy "products: members read"
  on public.products for select to authenticated
  using (app.can_read_tenant(tenant_id));

create policy "products: owner or platform inserts"
  on public.products for insert to authenticated
  with check (app.can_manage_tenant(tenant_id));

create policy "products: owner or platform updates"
  on public.products for update to authenticated
  using (app.can_manage_tenant(tenant_id))
  with check (app.can_manage_tenant(tenant_id));

create policy "products: owner or platform deletes"
  on public.products for delete to authenticated
  using (app.can_manage_tenant(tenant_id));

create policy "equipment: members read"
  on public.equipment for select to authenticated
  using (app.can_read_tenant(tenant_id));

create policy "equipment: owner or platform inserts"
  on public.equipment for insert to authenticated
  with check (app.can_manage_tenant(tenant_id));

create policy "equipment: owner or platform updates"
  on public.equipment for update to authenticated
  using (app.can_manage_tenant(tenant_id))
  with check (app.can_manage_tenant(tenant_id));

create policy "equipment: owner or platform deletes"
  on public.equipment for delete to authenticated
  using (app.can_manage_tenant(tenant_id));

-- ---------------------------------------------------------------------------
-- inventory_movements — append only
-- ---------------------------------------------------------------------------
create policy "inventory: members read"
  on public.inventory_movements for select to authenticated
  using (app.can_read_tenant(tenant_id));

create policy "inventory: staff post movements"
  on public.inventory_movements for insert to authenticated
  with check (app.can_operate_tenant(tenant_id));
-- No UPDATE or DELETE policy: the ledger is immutable. Migration 0011 also
-- revokes those privileges outright.

-- ---------------------------------------------------------------------------
-- sessions and session items — the daily operational surface
-- ---------------------------------------------------------------------------
create policy "sessions: members read"
  on public.sessions for select to authenticated
  using (app.can_read_tenant(tenant_id));

create policy "sessions: staff start"
  on public.sessions for insert to authenticated
  with check (app.can_operate_tenant(tenant_id));

create policy "sessions: staff update"
  on public.sessions for update to authenticated
  using (app.can_operate_tenant(tenant_id))
  with check (app.can_operate_tenant(tenant_id));

-- Deleting a session destroys financial history; cancelling is the normal path.
create policy "sessions: owner deletes"
  on public.sessions for delete to authenticated
  using (app.is_tenant_owner(tenant_id));

create policy "session items: members read"
  on public.session_items for select to authenticated
  using (app.can_read_tenant(tenant_id));

create policy "session items: staff add"
  on public.session_items for insert to authenticated
  with check (app.can_operate_tenant(tenant_id));

create policy "session items: staff update"
  on public.session_items for update to authenticated
  using (app.can_operate_tenant(tenant_id))
  with check (app.can_operate_tenant(tenant_id));

create policy "session items: staff remove"
  on public.session_items for delete to authenticated
  using (app.can_operate_tenant(tenant_id));

-- ---------------------------------------------------------------------------
-- Expenses and cash closing
-- ---------------------------------------------------------------------------
create policy "expense categories: members read"
  on public.expense_categories for select to authenticated
  using (app.can_read_tenant(tenant_id));

create policy "expense categories: owner or platform inserts"
  on public.expense_categories for insert to authenticated
  with check (app.can_manage_tenant(tenant_id));

create policy "expense categories: owner or platform updates"
  on public.expense_categories for update to authenticated
  using (app.can_manage_tenant(tenant_id))
  with check (app.can_manage_tenant(tenant_id));

create policy "expense categories: owner or platform deletes"
  on public.expense_categories for delete to authenticated
  using (app.can_manage_tenant(tenant_id));

create policy "expenses: members read"
  on public.expenses for select to authenticated
  using (app.can_read_tenant(tenant_id));

create policy "expenses: staff record"
  on public.expenses for insert to authenticated
  with check (app.can_operate_tenant(tenant_id));

-- A receptionist may correct an expense they entered; owners may correct any.
-- Owner-only rather than can_manage_tenant: a platform operator administers
-- clubs, it does not edit their books.
create policy "expenses: owner or author updates"
  on public.expenses for update to authenticated
  using (app.is_tenant_owner(tenant_id) or created_by = (select auth.uid()))
  with check (app.is_tenant_owner(tenant_id) or created_by = (select auth.uid()));

create policy "expenses: owner deletes"
  on public.expenses for delete to authenticated
  using (app.is_tenant_owner(tenant_id));

create policy "cash closings: members read"
  on public.cash_closings for select to authenticated
  using (app.can_read_tenant(tenant_id));

create policy "cash closings: staff open"
  on public.cash_closings for insert to authenticated
  with check (app.can_operate_tenant(tenant_id));

create policy "cash closings: staff reconcile"
  on public.cash_closings for update to authenticated
  using (app.can_operate_tenant(tenant_id))
  with check (app.can_operate_tenant(tenant_id));

create policy "cash closings: owner deletes"
  on public.cash_closings for delete to authenticated
  using (app.is_tenant_owner(tenant_id));

-- ---------------------------------------------------------------------------
-- notifications
-- ---------------------------------------------------------------------------
create policy "notifications: recipient or broadcast"
  on public.notifications for select to authenticated
  using (
    app.is_platform_admin()
    or (recipient_user_id = (select auth.uid()) and app.is_tenant_member(tenant_id))
    or (recipient_user_id is null and app.is_tenant_member(tenant_id))
  );

create policy "notifications: staff raise"
  on public.notifications for insert to authenticated
  with check (app.can_operate_tenant(tenant_id));

create policy "notifications: recipient marks read"
  on public.notifications for update to authenticated
  using (
    app.is_tenant_member(tenant_id)
    and (recipient_user_id = (select auth.uid()) or recipient_user_id is null)
  )
  with check (
    app.is_tenant_member(tenant_id)
    and (recipient_user_id = (select auth.uid()) or recipient_user_id is null)
  );

create policy "notifications: owner deletes"
  on public.notifications for delete to authenticated
  using (app.can_manage_tenant(tenant_id));

-- The UPDATE policy exists so a recipient can mark a notification read. This
-- guard stops it from being used to rewrite the message itself.
create or replace function app.notifications_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or app.can_manage_tenant(old.tenant_id) then
    return new;
  end if;
  if row(new.tenant_id, new.recipient_user_id, new.type, new.title, new.body, new.metadata,
         new.entity_type, new.entity_id, new.created_at)
     is distinct from
     row(old.tenant_id, old.recipient_user_id, old.type, old.title, old.body, old.metadata,
         old.entity_type, old.entity_id, old.created_at) then
    raise exception 'only the read state of a notification may be changed'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger notifications_guard
  before update on public.notifications
  for each row execute function app.notifications_guard();

-- ---------------------------------------------------------------------------
-- device_push_tokens — strictly personal
-- ---------------------------------------------------------------------------
create policy "push tokens: owner of the device reads"
  on public.device_push_tokens for select to authenticated
  using (user_id = (select auth.uid()));

create policy "push tokens: register own device"
  on public.device_push_tokens for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "push tokens: update own device"
  on public.device_push_tokens for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "push tokens: remove own device"
  on public.device_push_tokens for delete to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- activity_logs — append only, owner/platform readable
-- ---------------------------------------------------------------------------
create policy "activity: owner or platform reads"
  on public.activity_logs for select to authenticated
  using (
    (tenant_id is not null and app.can_manage_tenant(tenant_id))
    or (tenant_id is null and app.is_platform_admin())
  );

-- The actor is always the caller: a client cannot forge an entry attributed to
-- somebody else.
create policy "activity: staff append"
  on public.activity_logs for insert to authenticated
  with check (
    actor_user_id = (select auth.uid())
    and (
      (tenant_id is not null and app.can_operate_tenant(tenant_id))
      or (tenant_id is null and app.is_platform_admin())
    )
  );
-- No UPDATE or DELETE policy, and both are revoked in migration 0011.
