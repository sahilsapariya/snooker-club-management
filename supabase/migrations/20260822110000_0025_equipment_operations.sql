-- ============================================================================
-- 0025 · Equipment is configured by the owner and flagged by whoever is there
-- ============================================================================
-- `public.equipment` has had a schema, policies and seed data since migration
-- 0005, and no screen. Building one surfaced a boundary that was drawn in the
-- wrong place.
--
-- Every write was owner-only. But the thing that actually happens with a cue is
-- that a receptionist picks it up mid-shift, finds the tip gone, and needs to
-- say so. Making them phone the owner to mark a cue broken is how equipment
-- records stop matching the rack - and a record nobody maintains is worse than
-- no record, because people trust it.
--
-- So the split follows the same line as everything else in this schema:
--
--   configuration   what the club owns, what it cost, retiring it   OWNER
--   operations      what state it is in right now                   ANY STAFF
--
-- RLS cannot express "these columns only", so the column-level half is a guard
-- trigger - the same shape as `app.profiles_guard` and
-- `app.notifications_guard`.

-- ---------------------------------------------------------------------------
-- retired_at is not the client's to maintain
-- ---------------------------------------------------------------------------
-- `equipment_retired_consistency` requires `(status = 'RETIRED') = (retired_at
-- is not null)`. Leaving that to callers means every one of them has to
-- remember both halves, and the first to forget gets a constraint violation
-- with no useful message. Derived here instead, so the pair cannot come apart.
create or replace function app.equipment_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'RETIRED' then
    new.retired_at := coalesce(new.retired_at, now());
    -- A retired item is not on a table. Leaving the assignment would show a
    -- disposed cue as belonging to a table somebody is playing on.
    new.assigned_table_id := null;
  else
    new.retired_at := null;
  end if;

  return new;
end;
$$;

create trigger equipment_before_write
  before insert or update on public.equipment
  for each row execute function app.equipment_before_write();

-- ---------------------------------------------------------------------------
-- What a receptionist may change
-- ---------------------------------------------------------------------------
create or replace function app.equipment_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Migrations and the seed run without a caller; the owner may change anything.
  if (select auth.uid()) is null or app.is_tenant_owner(old.tenant_id) then
    return new;
  end if;

  -- Retiring is a disposal decision, not an observation about condition.
  if new.status = 'RETIRED' or old.status = 'RETIRED' then
    raise exception 'only the club owner can retire or restore equipment'
      using errcode = '42501';
  end if;

  if row(new.tenant_id, new.category, new.name, new.asset_code, new.assigned_table_id,
         new.purchased_at, new.purchase_price_minor, new.created_at)
     is distinct from
     row(old.tenant_id, old.category, old.name, old.asset_code, old.assigned_table_id,
         old.purchased_at, old.purchase_price_minor, old.created_at) then
    raise exception 'only the condition of a piece of equipment may be changed'
      using errcode = '42501',
            hint = 'Ask the club owner to change its details.';
  end if;

  return new;
end;
$$;

create trigger equipment_guard
  before update on public.equipment
  for each row execute function app.equipment_guard();

-- ---------------------------------------------------------------------------
-- The policy widens to match
-- ---------------------------------------------------------------------------
-- Insert and delete stay with the owner. Only UPDATE opens up, and the guard
-- above is what makes that safe to do.
drop policy if exists "equipment: owner updates" on public.equipment;

create policy "equipment: staff report condition, owner configures"
  on public.equipment for update to authenticated
  using (app.can_operate_tenant(tenant_id))
  with check (app.can_operate_tenant(tenant_id));

comment on table public.equipment is
  'Club assets. Owners add, price and retire; any member may report a change of condition.';
