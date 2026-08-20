-- ============================================================================
-- 0010 · Provisioning
-- ----------------------------------------------------------------------------
-- Automation that keeps the identity graph consistent, plus the small set of
-- privileged RPCs the platform admin needs. Everything here re-checks
-- authorization itself: SECURITY DEFINER functions bypass RLS by design, so
-- they must never assume the caller was already filtered.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- auth.users -> public.profiles
-- ---------------------------------------------------------------------------
create or replace function app.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, phone)
  values (
    new.id,
    new.email,
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'full_name',
                         new.raw_user_meta_data ->> 'name', '')), ''),
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'phone', new.phone, '')), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app.handle_new_auth_user();

create or replace function app.handle_auth_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles set email = new.email where id = new.id;
  return new;
end;
$$;

create trigger on_auth_user_email_updated
  after update of email on auth.users
  for each row
  when (old.email is distinct from new.email)
  execute function app.handle_auth_user_email_change();

-- ---------------------------------------------------------------------------
-- Tenant defaults
-- ---------------------------------------------------------------------------
-- Runs for every new club so it is immediately usable: billing settings, the
-- three standard table types, and the default expense/product categories.
-- Idempotent, so it is safe to re-run against an existing club.
create or replace function app.provision_tenant_defaults(p_tenant_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.tenant_billing_settings (tenant_id)
  values (p_tenant_id)
  on conflict (tenant_id) do nothing;

  insert into public.table_types (tenant_id, code, name, description, sort_order)
  values
    (p_tenant_id, 'POOL_SMALL',   'Pool (Small)',   'Compact pool table',        10),
    (p_tenant_id, 'POOL_REGULAR', 'Pool (Regular)', 'Standard size pool table',  20),
    (p_tenant_id, 'SNOOKER',      'Snooker',        'Full size snooker table',   30)
  on conflict (tenant_id, code) do nothing;

  insert into public.expense_categories (tenant_id, name, is_system, sort_order)
  values
    (p_tenant_id, 'Rent',        true, 10),
    (p_tenant_id, 'Electricity', true, 20),
    (p_tenant_id, 'Internet',    true, 30),
    (p_tenant_id, 'Salary',      true, 40),
    (p_tenant_id, 'Maintenance', true, 50),
    (p_tenant_id, 'Cleaning',    true, 60),
    (p_tenant_id, 'Equipment',   true, 70),
    (p_tenant_id, 'Other',       true, 80)
  on conflict do nothing;

  insert into public.product_categories (tenant_id, name, sort_order)
  values
    (p_tenant_id, 'Water',       10),
    (p_tenant_id, 'Cold Drinks', 20),
    (p_tenant_id, 'Snacks',      30),
    (p_tenant_id, 'Other',       40)
  on conflict do nothing;
end;
$$;

comment on function app.provision_tenant_defaults(uuid) is
  'Seeds billing settings, table types and default categories for a club. Idempotent.';

create or replace function app.on_tenant_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.provision_tenant_defaults(new.id);
  return new;
end;
$$;

create trigger tenants_provision_defaults
  after insert on public.tenants
  for each row execute function app.on_tenant_created();

-- ---------------------------------------------------------------------------
-- Platform RPCs
-- ---------------------------------------------------------------------------

-- Create a club and seed its defaults in one call.
create or replace function public.platform_create_tenant(
  p_name            text,
  p_slug            text,
  p_primary_color   text default '#059669',
  p_secondary_color text default null,
  p_currency_code   char(3) default 'INR',
  p_timezone        text default 'Asia/Kolkata',
  p_status          public.tenant_status default 'ACTIVE'
)
returns public.tenants
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant public.tenants;
begin
  if not app.is_platform_admin() then
    raise exception 'only platform administrators may create tenants'
      using errcode = '42501';
  end if;

  insert into public.tenants (name, slug, primary_color, secondary_color, currency_code, timezone, status)
  values (p_name, p_slug, p_primary_color, p_secondary_color, p_currency_code, p_timezone, p_status)
  returning * into v_tenant;

  insert into public.activity_logs (tenant_id, actor_user_id, actor_role, action, entity_type, entity_id, summary)
  values (v_tenant.id, (select auth.uid()), 'PLATFORM_SUPER_ADMIN', 'tenant.created',
          'tenant', v_tenant.id, format('Tenant %s created', v_tenant.name));

  return v_tenant;
end;
$$;

-- Attach an existing authenticated user to a club. Callable by the club's owner
-- (to add a receptionist) or by a platform operator.
--
-- The user must already exist in Supabase Auth - this product does not create
-- credentials from the client. See docs/operations.md for the invite flow.
create or replace function public.add_tenant_member(
  p_tenant_id uuid,
  p_email     text,
  p_role      public.tenant_role
)
returns public.tenant_memberships
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id    uuid;
  v_membership public.tenant_memberships;
begin
  if not app.can_manage_tenant(p_tenant_id) then
    raise exception 'insufficient privileges to manage staff for this club'
      using errcode = '42501';
  end if;

  select p.id into v_user_id
    from public.profiles p
   where lower(p.email) = lower(trim(p_email));

  if v_user_id is null then
    raise exception 'no account exists for %', p_email
      using errcode = 'P0002',
            hint = 'Create the account in Supabase Auth first, then add the membership.';
  end if;

  insert into public.tenant_memberships (tenant_id, user_id, role, status, invited_by, invited_at, joined_at)
  values (p_tenant_id, v_user_id, p_role, 'ACTIVE', (select auth.uid()), now(), now())
  on conflict (tenant_id, user_id)
    do update set role = excluded.role, status = 'ACTIVE', updated_at = now()
  returning * into v_membership;

  insert into public.activity_logs (tenant_id, actor_user_id, action, entity_type, entity_id, summary)
  values (p_tenant_id, (select auth.uid()), 'membership.upserted', 'tenant_membership',
          v_membership.id, format('%s added as %s', p_email, p_role));

  return v_membership;
end;
$$;

comment on function public.add_tenant_member(uuid, text, public.tenant_role) is
  'Owner/platform-only. Links an existing Supabase Auth account to a club with a role.';

-- Update a club's platform-controlled fields.
--
-- `public.tenants` is not writable by the `authenticated` role at all (see
-- migration 0011), so this RPC is the only path a signed-in platform operator
-- has to change branding, locale or contact details. Passing NULL leaves a
-- field untouched.
create or replace function public.platform_update_tenant(
  p_tenant_id       uuid,
  p_name            text default null,
  p_logo_url        text default null,
  p_primary_color   text default null,
  p_secondary_color text default null,
  p_theme_preset    text default null,
  p_currency_code   char(3) default null,
  p_timezone        text default null,
  p_contact_name    text default null,
  p_contact_email   text default null,
  p_contact_phone   text default null
)
returns public.tenants
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant public.tenants;
begin
  if not app.is_platform_admin() then
    raise exception 'only platform administrators may change club configuration'
      using errcode = '42501';
  end if;

  update public.tenants t
     set name            = coalesce(p_name, t.name),
         logo_url        = coalesce(p_logo_url, t.logo_url),
         primary_color   = coalesce(p_primary_color, t.primary_color),
         secondary_color = coalesce(p_secondary_color, t.secondary_color),
         theme_preset    = coalesce(p_theme_preset, t.theme_preset),
         currency_code   = coalesce(p_currency_code, t.currency_code),
         timezone        = coalesce(p_timezone, t.timezone),
         contact_name    = coalesce(p_contact_name, t.contact_name),
         contact_email   = coalesce(p_contact_email, t.contact_email),
         contact_phone   = coalesce(p_contact_phone, t.contact_phone)
   where t.id = p_tenant_id
  returning * into v_tenant;

  if v_tenant.id is null then
    raise exception 'tenant % not found', p_tenant_id using errcode = 'P0002';
  end if;

  insert into public.activity_logs (tenant_id, actor_user_id, actor_role, action, entity_type, entity_id, summary)
  values (p_tenant_id, (select auth.uid()), 'PLATFORM_SUPER_ADMIN', 'tenant.updated',
          'tenant', p_tenant_id, format('Configuration updated for %s', v_tenant.name));

  return v_tenant;
end;
$$;

create or replace function public.platform_set_tenant_status(
  p_tenant_id uuid,
  p_status    public.tenant_status
)
returns public.tenants
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant public.tenants;
begin
  if not app.is_platform_admin() then
    raise exception 'only platform administrators may change tenant status'
      using errcode = '42501';
  end if;

  update public.tenants set status = p_status where id = p_tenant_id
  returning * into v_tenant;

  if v_tenant.id is null then
    raise exception 'tenant % not found', p_tenant_id using errcode = 'P0002';
  end if;

  insert into public.activity_logs (tenant_id, actor_user_id, actor_role, action, entity_type, entity_id, summary)
  values (p_tenant_id, (select auth.uid()), 'PLATFORM_SUPER_ADMIN', 'tenant.status_changed',
          'tenant', p_tenant_id, format('Status set to %s', p_status));

  return v_tenant;
end;
$$;

comment on function public.platform_update_tenant is
  'Platform-only. The single write path for club branding and configuration; public.tenants is not writable by clients.';
