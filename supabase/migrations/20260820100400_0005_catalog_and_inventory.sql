-- ============================================================================
-- 0005 · Products, inventory ledger and equipment
-- ----------------------------------------------------------------------------
-- Consumables (sold to customers) and equipment (club assets) are deliberately
-- separate models: a cue is tracked by status, a bottle of water by quantity.
--
-- Stock is a LEDGER, not a number. `products.stock_quantity` is a cached
-- projection maintained by a trigger over `inventory_movements`, which is
-- append-only. That gives an auditable history and makes drift detectable.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- product_categories
-- ---------------------------------------------------------------------------
create table public.product_categories (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants (id) on delete cascade,
  name       text not null,
  sort_order smallint not null default 0,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint product_categories_name_not_blank check (length(trim(name)) > 0),
  constraint product_categories_tenant_id_key unique (tenant_id, id)
);

create unique index product_categories_unique_name
  on public.product_categories (tenant_id, lower(name));

create trigger product_categories_set_updated_at
  before update on public.product_categories
  for each row execute function app.set_updated_at();

alter table public.product_categories enable row level security;

-- ---------------------------------------------------------------------------
-- products
-- ---------------------------------------------------------------------------
create table public.products (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references public.tenants (id) on delete cascade,
  category_id          uuid,

  name                 text not null,
  sku                  text,
  description          text,

  selling_price_minor  bigint not null,
  cost_price_minor     bigint,

  -- Cached projection of inventory_movements. Never write this directly;
  -- insert a movement instead.
  stock_quantity       numeric(12, 3) not null default 0,
  low_stock_threshold  numeric(12, 3) not null default 0,
  track_inventory      boolean not null default true,
  unit                 text not null default 'pcs',

  is_active            boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  constraint products_name_not_blank check (length(trim(name)) > 0),
  constraint products_selling_price_non_negative check (selling_price_minor >= 0),
  constraint products_cost_price_non_negative check (cost_price_minor is null or cost_price_minor >= 0),
  constraint products_low_stock_non_negative check (low_stock_threshold >= 0),
  constraint products_tenant_id_key unique (tenant_id, id),
  constraint products_category_same_tenant
    foreign key (tenant_id, category_id)
    references public.product_categories (tenant_id, id)
    on update cascade on delete no action
);

create unique index products_unique_name on public.products (tenant_id, lower(name));
create unique index products_unique_sku  on public.products (tenant_id, lower(sku)) where sku is not null;
create index products_tenant_active_idx  on public.products (tenant_id, is_active, name);
create index products_low_stock_idx
  on public.products (tenant_id)
  where track_inventory and is_active;

comment on column public.products.stock_quantity is
  'Derived cache of the inventory_movements ledger, maintained by trigger. Do not update directly.';

create trigger products_set_updated_at
  before update on public.products
  for each row execute function app.set_updated_at();

alter table public.products enable row level security;

-- ---------------------------------------------------------------------------
-- inventory_movements — the append-only stock ledger
-- ---------------------------------------------------------------------------
create table public.inventory_movements (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants (id) on delete cascade,
  product_id     uuid not null,
  movement_type  public.inventory_movement_type not null,

  -- Signed: +5 received, -2 sold. Never zero.
  quantity_delta numeric(12, 3) not null,
  unit_cost_minor bigint,

  -- Free-form provenance so a movement can point at a session item, a purchase
  -- note, a stock-take, ...
  reference_type text,
  reference_id   uuid,
  note           text,

  created_by     uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),

  constraint inventory_movements_delta_not_zero check (quantity_delta <> 0),
  constraint inventory_movements_unit_cost_non_negative
    check (unit_cost_minor is null or unit_cost_minor >= 0),
  constraint inventory_movements_product_same_tenant
    foreign key (tenant_id, product_id)
    references public.products (tenant_id, id)
    on update cascade on delete no action
);

create index inventory_movements_product_idx on public.inventory_movements (product_id, created_at desc);
create index inventory_movements_tenant_idx  on public.inventory_movements (tenant_id, created_at desc);
create index inventory_movements_reference_idx
  on public.inventory_movements (reference_type, reference_id)
  where reference_id is not null;

comment on table public.inventory_movements is
  'Append-only stock ledger. UPDATE/DELETE are revoked at the grant level, not merely absent from RLS.';

alter table public.inventory_movements enable row level security;

-- Keep products.stock_quantity in step with the ledger.
create or replace function app.apply_inventory_movement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.products
     set stock_quantity = stock_quantity + new.quantity_delta
   where id = new.product_id;
  return new;
end;
$$;

create trigger inventory_movements_apply
  after insert on public.inventory_movements
  for each row execute function app.apply_inventory_movement();

-- ---------------------------------------------------------------------------
-- equipment — club assets, tracked individually by status
-- ---------------------------------------------------------------------------
create table public.equipment (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references public.tenants (id) on delete cascade,
  category             public.equipment_category not null default 'OTHER',
  name                 text not null,
  asset_code           text,
  status               public.equipment_status not null default 'AVAILABLE',
  assigned_table_id    uuid,
  purchased_at         date,
  purchase_price_minor bigint,
  notes                text,
  retired_at           timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  constraint equipment_name_not_blank check (length(trim(name)) > 0),
  constraint equipment_price_non_negative
    check (purchase_price_minor is null or purchase_price_minor >= 0),
  constraint equipment_retired_consistency
    check ((status = 'RETIRED') = (retired_at is not null)),
  constraint equipment_table_same_tenant
    foreign key (tenant_id, assigned_table_id)
    references public.club_tables (tenant_id, id)
    on update cascade on delete no action
);

create unique index equipment_unique_asset_code
  on public.equipment (tenant_id, lower(asset_code))
  where asset_code is not null;

create index equipment_tenant_status_idx on public.equipment (tenant_id, status);

comment on table public.equipment is
  'Physical club assets (cues, ball sets, rests). Distinct from consumable inventory - tracked by status, not quantity.';

create trigger equipment_set_updated_at
  before update on public.equipment
  for each row execute function app.set_updated_at();

alter table public.equipment enable row level security;
