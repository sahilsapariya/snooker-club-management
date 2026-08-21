-- ============================================================================
-- Local development seed
-- ----------------------------------------------------------------------------
-- Runs automatically after `pnpm db:reset`. LOCAL DEVELOPMENT ONLY.
--
-- Auth accounts
-- -------------
-- This file creates rows in `auth.users` directly, which is safe because a
-- local Supabase stack is throwaway and unreachable from the internet. The
-- passwords below are deliberately obvious development passwords - they are not
-- credentials, they are fixtures. NEVER run this file against a hosted project.
--
-- For staging/production, accounts are created through Supabase Auth (dashboard
-- or Admin API) and then linked with `select public.add_tenant_member(...)`.
-- See docs/operations.md.
--
-- Development logins (all use the password `DevPassword123`):
--
--   admin@snookerplatform.dev     platform super admin (no club)
--   owner@royalsnooker.dev        OWNER        of Royal Snooker Club AND Cue
--                                              Lounge - the multi-club case
--   reception@royalsnooker.dev    RECEPTIONIST of Royal Snooker Club
--   owner@bluecue.dev             OWNER        of Blue Cue Club
--   reception@bluecue.dev         RECEPTIONIST of Blue Cue Club
--
-- Three clubs exist on purpose. Two are needed before tenant isolation is
-- testable at all; the third gives one owner two clubs, which is what makes the
-- club selector, the club switcher and per-club cache isolation exercisable
-- without hand-building data first.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- Auth users
-- ---------------------------------------------------------------------------
with dev_users (id, email) as (
  values
    ('11111111-1111-4111-8111-111111111111'::uuid, 'admin@snookerplatform.dev'),
    ('22222222-2222-4222-8222-222222222222'::uuid, 'owner@royalsnooker.dev'),
    ('33333333-3333-4333-8333-333333333333'::uuid, 'reception@royalsnooker.dev'),
    ('44444444-4444-4444-8444-444444444444'::uuid, 'owner@bluecue.dev'),
    ('55555555-5555-4555-8555-555555555555'::uuid, 'reception@bluecue.dev')
)
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at,
  -- These columns are nullable in the schema but GoTrue scans them into
  -- non-nullable Go strings. Leaving them NULL makes every sign-in fail with
  -- "Database error querying schema" / a scan error on confirmation_token.
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, phone_change, phone_change_token,
  reauthentication_token
)
select
  '00000000-0000-0000-0000-000000000000',
  u.id,
  'authenticated',
  'authenticated',
  u.email,
  extensions.crypt('DevPassword123', extensions.gen_salt('bf')),
  now(),
  jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
  jsonb_build_object('full_name', initcap(replace(split_part(u.email, '@', 1), '.', ' '))),
  now(),
  now(),
  '', '', '', '', '', '', '', ''
from dev_users u
on conflict (id) do nothing;

-- Email/password identities, required for password sign-in to work.
insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
select
  gen_random_uuid(), u.id, u.id::text, 'email',
  jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
  now(), now(), now()
from auth.users u
where u.email like '%.dev'
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Platform super admin
-- ---------------------------------------------------------------------------
insert into public.platform_admins (user_id, role, notes)
values ('11111111-1111-4111-8111-111111111111', 'SUPER_ADMIN', 'Local development platform owner')
on conflict (user_id) do nothing;

-- ---------------------------------------------------------------------------
-- Tenants
-- ---------------------------------------------------------------------------
-- The AFTER INSERT trigger provisions billing settings, table types and the
-- default expense/product categories for each club automatically.
insert into public.tenants (
  id, slug, name, status, primary_color, secondary_color, theme_preset,
  currency_code, timezone, business_day_cutoff,
  contact_name, contact_email, contact_phone, address_line1, city, state, postal_code
)
values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'royal-snooker', 'Royal Snooker Club', 'ACTIVE',
   '#059669', '#0F766E', 'emerald', 'INR', 'Asia/Kolkata', '04:00',
   'Ravi Menon', 'contact@royalsnooker.dev', '+91 98765 43210',
   '12 Marine Drive', 'Kochi', 'Kerala', '682011'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'blue-cue', 'Blue Cue Club', 'ACTIVE',
   '#2563EB', '#1E40AF', 'ocean', 'INR', 'Asia/Kolkata', '00:00',
   'Anita Rao', 'contact@bluecue.dev', '+91 91234 56780',
   '44 Residency Road', 'Bengaluru', 'Karnataka', '560025'),
  -- Second club for the Royal owner. Its whole purpose is to make the
  -- multi-club path real in development: the same login reaches two clubs, so
  -- the selector, the switcher and per-club cache isolation are all exercised
  -- without hand-building data first. Branded differently on purpose, so a
  -- theme that fails to follow a club switch is obvious on sight.
  ('cccccccc-0000-4000-8000-000000000003', 'cue-lounge', 'Cue Lounge', 'ACTIVE',
   '#9F1239', '#6D1029', 'burgundy', 'INR', 'Asia/Kolkata', '02:00',
   'Ravi Menon', 'contact@cuelounge.dev', '+91 98765 11223',
   '7 Fort Road', 'Kochi', 'Kerala', '682001')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Memberships
-- ---------------------------------------------------------------------------
insert into public.tenant_memberships (tenant_id, user_id, role, status, joined_at)
values
  ('aaaaaaaa-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'OWNER',        'ACTIVE', now()),
  ('aaaaaaaa-0000-4000-8000-000000000001', '33333333-3333-4333-8333-333333333333', 'RECEPTIONIST', 'ACTIVE', now()),
  ('bbbbbbbb-0000-4000-8000-000000000002', '44444444-4444-4444-8444-444444444444', 'OWNER',        'ACTIVE', now()),
  ('bbbbbbbb-0000-4000-8000-000000000002', '55555555-5555-4555-8555-555555555555', 'RECEPTIONIST', 'ACTIVE', now()),
  -- One owner, two clubs, one login. Allowed since migration 0015 narrowed the
  -- single-active-membership rule to receptionists.
  ('cccccccc-0000-4000-8000-000000000003', '22222222-2222-4222-8222-222222222222', 'OWNER',        'ACTIVE', now())
on conflict (tenant_id, user_id) do nothing;

-- ---------------------------------------------------------------------------
-- Billing rules — the two clubs are configured differently on purpose, to prove
-- nothing about billing is hard-coded.
-- ---------------------------------------------------------------------------
update public.tenant_billing_settings
   set time_calculation_mode      = 'FIXED_INCREMENT',
       billing_increment_minutes  = 30,
       minimum_billable_minutes   = 30,
       rounding_mode              = 'ROUND_UP',
       rounding_increment_minutes = 15,
       grace_period_minutes       = 5,
       overtime_mode              = 'SAME_RATE',
       frame_billing_enabled      = true,
       default_frame_price_minor  = 5000            -- ₹50.00 per frame
 where tenant_id = 'aaaaaaaa-0000-4000-8000-000000000001';

update public.tenant_billing_settings
   set time_calculation_mode      = 'PER_MINUTE',
       billing_increment_minutes  = 1,
       minimum_billable_minutes   = 15,
       rounding_mode              = 'NEAREST',
       rounding_increment_minutes = 5,
       grace_period_minutes       = 0,
       overtime_mode              = 'OVERTIME_RATE',
       overtime_rate_minor        = 40000,          -- ₹400.00 / hour after the booked time
       frame_billing_enabled      = false
 where tenant_id = 'bbbbbbbb-0000-4000-8000-000000000002';

update public.tenant_billing_settings
   set time_calculation_mode      = 'PER_HOUR',
       billing_increment_minutes  = 60,
       minimum_billable_minutes   = 30,
       rounding_mode              = 'ROUND_UP',
       rounding_increment_minutes = 30,
       grace_period_minutes       = 10,
       overtime_mode              = 'INCREMENT_BLOCK',
       overtime_rate_minor        = 20000,       -- Rs 200.00 per overtime block
       overtime_increment_minutes = 30,
       frame_billing_enabled      = true,
       default_frame_price_minor  = 7500         -- Rs 75.00 per frame
 where tenant_id = 'cccccccc-0000-4000-8000-000000000003';

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
insert into public.club_tables (tenant_id, table_type_id, name, table_number, status, is_active, sort_order, notes)
select t.tenant_id, t.id, v.name, v.number, v.status::public.club_table_status, v.is_active, v.sort_order, v.notes
from (values
  ('aaaaaaaa-0000-4000-8000-000000000001'::uuid, 'SNOOKER',      'Snooker 1', 1, 'AVAILABLE',   true,  10, null),
  ('aaaaaaaa-0000-4000-8000-000000000001'::uuid, 'SNOOKER',      'Snooker 2', 2, 'AVAILABLE',   true,  20, null),
  ('aaaaaaaa-0000-4000-8000-000000000001'::uuid, 'POOL_REGULAR', 'Pool 1',    3, 'AVAILABLE',   true,  30, null),
  ('aaaaaaaa-0000-4000-8000-000000000001'::uuid, 'POOL_REGULAR', 'Pool 2',    4, 'MAINTENANCE', true,  40, 'Cloth being replaced'),
  ('aaaaaaaa-0000-4000-8000-000000000001'::uuid, 'POOL_SMALL',   'Pool Mini', 5, 'AVAILABLE',   false, 50, 'Retired from the floor'),
  ('bbbbbbbb-0000-4000-8000-000000000002'::uuid, 'SNOOKER',      'Snooker A', 1, 'AVAILABLE',   true,  10, null),
  ('bbbbbbbb-0000-4000-8000-000000000002'::uuid, 'POOL_REGULAR', 'Pool A',    2, 'AVAILABLE',   true,  20, null),
  ('bbbbbbbb-0000-4000-8000-000000000002'::uuid, 'POOL_SMALL',   'Pool B',    3, 'AVAILABLE',   true,  30, null),
  ('cccccccc-0000-4000-8000-000000000003'::uuid, 'SNOOKER',      'Lounge 1',  1, 'AVAILABLE',   true,  10, null),
  ('cccccccc-0000-4000-8000-000000000003'::uuid, 'POOL_REGULAR', 'Lounge 2',  2, 'AVAILABLE',   true,  20, null)
) as v(tenant_id, type_code, name, number, status, is_active, sort_order, notes)
join public.table_types t on t.tenant_id = v.tenant_id and t.code = v.type_code
on conflict (tenant_id, name) do nothing;

-- ---------------------------------------------------------------------------
-- Pricing rules
-- ---------------------------------------------------------------------------
insert into public.pricing_rules (tenant_id, table_type_id, name, pricing_mode, rate_minor,
                                  increment_minutes, minimum_minutes, frame_price_minor, is_default)
select t.tenant_id, t.id, v.name, v.mode::public.pricing_mode, v.rate,
       v.increment, v.minimum, v.frame_price, true
from (values
  ('aaaaaaaa-0000-4000-8000-000000000001'::uuid, 'SNOOKER',      'Snooker · half-hourly', 'FIXED_INCREMENT', 15000::bigint, 30, 30, 5000::bigint),
  ('aaaaaaaa-0000-4000-8000-000000000001'::uuid, 'POOL_REGULAR', 'Pool · half-hourly',    'FIXED_INCREMENT', 10000::bigint, 30, 30, null::bigint),
  ('aaaaaaaa-0000-4000-8000-000000000001'::uuid, 'POOL_SMALL',   'Mini pool · hourly',    'PER_HOUR',        12000::bigint, null, 30, null::bigint),
  ('bbbbbbbb-0000-4000-8000-000000000002'::uuid, 'SNOOKER',      'Snooker · hourly',      'PER_HOUR',        36000::bigint, null, 15, null::bigint),
  ('bbbbbbbb-0000-4000-8000-000000000002'::uuid, 'POOL_REGULAR', 'Pool · hourly',         'PER_HOUR',        24000::bigint, null, 15, null::bigint),
  ('bbbbbbbb-0000-4000-8000-000000000002'::uuid, 'POOL_SMALL',   'Mini pool · hourly',    'PER_HOUR',        18000::bigint, null, 15, null::bigint),
  ('cccccccc-0000-4000-8000-000000000003'::uuid, 'SNOOKER',      'Lounge snooker',        'PER_HOUR',        42000::bigint, null, 30, null::bigint),
  ('cccccccc-0000-4000-8000-000000000003'::uuid, 'POOL_REGULAR', 'Lounge pool',           'PER_HOUR',        30000::bigint, null, 30, null::bigint)
) as v(tenant_id, type_code, name, mode, rate, increment, minimum, frame_price)
join public.table_types t on t.tenant_id = v.tenant_id and t.code = v.type_code
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Products
-- ---------------------------------------------------------------------------
insert into public.products (tenant_id, category_id, name, selling_price_minor, cost_price_minor,
                             low_stock_threshold, unit)
select c.tenant_id, c.id, v.name, v.price, v.cost, v.threshold, v.unit
from (values
  ('aaaaaaaa-0000-4000-8000-000000000001'::uuid, 'Water',       'Mineral Water 1L',   2000::bigint, 1200::bigint, 12::numeric, 'bottle'),
  ('aaaaaaaa-0000-4000-8000-000000000001'::uuid, 'Cold Drinks', 'Cola 300ml',         4000::bigint, 2600::bigint, 24::numeric, 'bottle'),
  ('aaaaaaaa-0000-4000-8000-000000000001'::uuid, 'Cold Drinks', 'Lemon Soda',         3500::bigint, 2000::bigint, 12::numeric, 'bottle'),
  ('aaaaaaaa-0000-4000-8000-000000000001'::uuid, 'Snacks',      'Salted Peanuts',     3000::bigint, 1800::bigint,  10::numeric, 'pack'),
  ('aaaaaaaa-0000-4000-8000-000000000001'::uuid, 'Snacks',      'Potato Chips',       2500::bigint, 1500::bigint,  10::numeric, 'pack'),
  ('bbbbbbbb-0000-4000-8000-000000000002'::uuid, 'Water',       'Mineral Water 1L',   2500::bigint, 1400::bigint, 10::numeric, 'bottle'),
  ('bbbbbbbb-0000-4000-8000-000000000002'::uuid, 'Cold Drinks', 'Iced Tea',           5000::bigint, 3000::bigint,  8::numeric, 'bottle'),
  ('bbbbbbbb-0000-4000-8000-000000000002'::uuid, 'Snacks',      'Masala Peanuts',     3500::bigint, 2000::bigint,  8::numeric, 'pack')
) as v(tenant_id, category, name, price, cost, threshold, unit)
join public.product_categories c on c.tenant_id = v.tenant_id and c.name = v.category
on conflict (tenant_id, lower(name)) do nothing;

-- Opening stock, posted through the ledger so products.stock_quantity is
-- derived rather than typed in.
insert into public.inventory_movements (tenant_id, product_id, movement_type, quantity_delta, unit_cost_minor, note)
select p.tenant_id, p.id, 'OPENING_BALANCE', 48, p.cost_price_minor, 'Development opening stock'
from public.products p;

-- Push one product under its threshold so the low-stock view has something in it.
insert into public.inventory_movements (tenant_id, product_id, movement_type, quantity_delta, note)
select p.tenant_id, p.id, 'SALE', -40, 'Development: drive Cola below its low-stock threshold'
from public.products p
where p.tenant_id = 'aaaaaaaa-0000-4000-8000-000000000001' and p.name = 'Cola 300ml';

-- ---------------------------------------------------------------------------
-- Equipment
-- ---------------------------------------------------------------------------
insert into public.equipment (tenant_id, category, name, asset_code, status, purchase_price_minor, notes)
values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'CUE',      'House Cue A',      'CUE-A', 'AVAILABLE',    350000, null),
  ('aaaaaaaa-0000-4000-8000-000000000001', 'CUE',      'House Cue B',      'CUE-B', 'NEEDS_REPAIR', 350000, 'Tip needs replacing'),
  ('aaaaaaaa-0000-4000-8000-000000000001', 'REST_CUE', 'Spider Rest',      'RST-1', 'AVAILABLE',     90000, null),
  ('aaaaaaaa-0000-4000-8000-000000000001', 'BALL_SET', 'Snooker Ball Set', 'BAL-1', 'IN_USE',      1200000, null),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'CUE',      'House Cue 1',      'C-1',   'AVAILABLE',    300000, null),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'BALL_SET', 'Pool Ball Set',    'B-1',   'AVAILABLE',    600000, null)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Expenses
-- ---------------------------------------------------------------------------
insert into public.expenses (tenant_id, category_id, amount_minor, expense_date, payment_method, note, created_by)
select c.tenant_id, c.id, v.amount, current_date - v.days_ago, v.method::public.payment_method, v.note, v.created_by
from (values
  ('aaaaaaaa-0000-4000-8000-000000000001'::uuid, 'Electricity', 1250000::bigint, 3, 'BANK_TRANSFER', 'Monthly electricity bill', '22222222-2222-4222-8222-222222222222'::uuid),
  ('aaaaaaaa-0000-4000-8000-000000000001'::uuid, 'Cleaning',      80000::bigint, 1, 'CASH',          'Daily cleaning',           '33333333-3333-4333-8333-333333333333'::uuid),
  ('aaaaaaaa-0000-4000-8000-000000000001'::uuid, 'Maintenance',  450000::bigint, 0, 'CASH',          'Cloth repair on Pool 2',   '22222222-2222-4222-8222-222222222222'::uuid),
  ('bbbbbbbb-0000-4000-8000-000000000002'::uuid, 'Rent',       4500000::bigint, 5, 'BANK_TRANSFER', 'Monthly rent',             '44444444-4444-4444-8444-444444444444'::uuid)
) as v(tenant_id, category, amount, days_ago, method, note, created_by)
join public.expense_categories c on c.tenant_id = v.tenant_id and c.name = v.category;

-- ---------------------------------------------------------------------------
-- One open session, so the Tables screen has an occupied table to render.
-- Note that no `ended_at` is set: an open session has none, by constraint.
-- ---------------------------------------------------------------------------
insert into public.sessions (
  tenant_id, table_id, pricing_rule_id, status, started_at, started_by,
  planned_duration_minutes, table_charge_minor, pricing_snapshot, customer_name
)
select
  ct.tenant_id,
  ct.id,
  pr.id,
  'ACTIVE',
  now() - interval '42 minutes',
  '33333333-3333-4333-8333-333333333333',
  60,
  0,
  jsonb_build_object(
    'pricing_rule_id', pr.id,
    'pricing_mode', pr.pricing_mode,
    'rate_minor', pr.rate_minor,
    'increment_minutes', pr.increment_minutes,
    'captured_at', now()
  ),
  'Walk-in'
from public.club_tables ct
join public.table_types tt on tt.id = ct.table_type_id
join public.pricing_rules pr on pr.tenant_id = ct.tenant_id and pr.table_type_id = tt.id and pr.is_default
where ct.tenant_id = 'aaaaaaaa-0000-4000-8000-000000000001'
  and ct.name = 'Snooker 1';

-- A drink sold against that session. The trigger snapshots the price, rolls the
-- total onto the session and posts the stock movement.
insert into public.session_items (tenant_id, session_id, product_id, quantity, added_by, product_name_snapshot, unit_price_minor)
select s.tenant_id, s.id, p.id, 2, '33333333-3333-4333-8333-333333333333', '', null
from public.sessions s
join public.products p on p.tenant_id = s.tenant_id and p.name = 'Mineral Water 1L'
where s.tenant_id = 'aaaaaaaa-0000-4000-8000-000000000001'
  and s.status = 'ACTIVE';

-- ---------------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------------
insert into public.notifications (tenant_id, recipient_user_id, type, title, body, metadata)
values
  ('aaaaaaaa-0000-4000-8000-000000000001', null, 'LOW_STOCK', 'Cola 300ml is running low',
   'Stock has fallen to or below the configured threshold.', jsonb_build_object('product_name', 'Cola 300ml')),
  ('aaaaaaaa-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'SESSION_STARTED',
   'Snooker 1 is in play', 'A session was started by the receptionist.', '{}'::jsonb);

-- ---------------------------------------------------------------------------
-- Activity log — a few representative operational events.
-- ---------------------------------------------------------------------------
insert into public.activity_logs (tenant_id, actor_user_id, actor_role, action, entity_type, entity_id, summary)
select s.tenant_id, s.started_by, 'RECEPTIONIST', 'session.started', 'session', s.id,
       format('Session started on %s', ct.name)
from public.sessions s
join public.club_tables ct on ct.id = s.table_id;

insert into public.activity_logs (tenant_id, actor_user_id, actor_role, action, entity_type, entity_id, summary)
select e.tenant_id, e.created_by, 'OWNER', 'expense.created', 'expense', e.id,
       format('Expense recorded: %s', coalesce(e.note, 'no note'))
from public.expenses e;

insert into public.activity_logs (tenant_id, actor_user_id, actor_role, action, entity_type, entity_id, summary)
values (
  'aaaaaaaa-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  'PLATFORM_SUPER_ADMIN',
  'tenant.created',
  'tenant',
  'aaaaaaaa-0000-4000-8000-000000000001',
  'Tenant Royal Snooker Club provisioned'
);

commit;
