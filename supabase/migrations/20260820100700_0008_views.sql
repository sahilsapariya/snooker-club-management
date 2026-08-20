-- ============================================================================
-- 0008 · Read models
-- ----------------------------------------------------------------------------
-- Views are declared WITH (security_invoker = true) so they run with the
-- privileges - and therefore the RLS policies - of the querying user. Without
-- it a view silently becomes a tenant-isolation bypass.
-- ============================================================================

-- What the Tables screen renders: every table, its type, and the open session
-- occupying it (if any).
create view public.v_club_table_overview
with (security_invoker = true) as
select
  ct.id,
  ct.tenant_id,
  ct.name,
  ct.table_number,
  ct.status,
  ct.is_active,
  ct.notes,
  ct.sort_order,
  ct.table_type_id,
  tt.code                        as table_type_code,
  tt.name                        as table_type_name,
  s.id                           as active_session_id,
  s.status                       as active_session_status,
  s.started_at                   as active_session_started_at,
  s.planned_duration_minutes     as active_session_planned_minutes,
  s.total_amount_minor           as active_session_total_minor,
  (s.id is not null)             as is_occupied
from public.club_tables ct
join public.table_types tt on tt.id = ct.table_type_id
left join lateral (
  select
    open_session.id,
    open_session.status,
    open_session.started_at,
    open_session.planned_duration_minutes,
    open_session.total_amount_minor
  from public.sessions open_session
  where open_session.table_id = ct.id
    and open_session.status in ('ACTIVE', 'TIME_COMPLETED')
  order by open_session.started_at desc
  limit 1
) s on true;

comment on view public.v_club_table_overview is
  'Tables plus their current occupancy. security_invoker=true so tenant RLS still applies.';

-- Low-stock watchlist, used to raise LOW_STOCK notifications.
create view public.v_low_stock_products
with (security_invoker = true) as
select
  p.id,
  p.tenant_id,
  p.name,
  p.stock_quantity,
  p.low_stock_threshold,
  p.unit,
  p.selling_price_minor
from public.products p
where p.is_active
  and p.track_inventory
  and p.stock_quantity <= p.low_stock_threshold;

comment on view public.v_low_stock_products is
  'Active, inventory-tracked products at or below their low-stock threshold.';
