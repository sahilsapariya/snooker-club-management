-- ============================================================================
-- 0012 · The business date belongs to the server, not the client
-- ----------------------------------------------------------------------------
-- `sessions.business_date` is NOT NULL with no default, filled by a BEFORE
-- INSERT trigger from the tenant's timezone and trading-day cutoff. That works,
-- but PostgREST cannot see the trigger, so the generated TypeScript types mark
-- the column as required on insert and every client is pushed into computing a
-- business date itself - the one thing it must not do, since it does not know
-- the club's timezone or cutoff.
--
-- Two changes:
--   1. A default, so the column becomes optional in the generated types.
--   2. The trigger now *always* derives the value on INSERT instead of only
--      filling a NULL. Combined, a client can neither omit it (the default
--      covers that) nor forge it (the trigger overwrites whatever arrives).
--
-- `expenses.expense_date` deliberately keeps its fill-if-null behaviour: an
-- expense legitimately belongs to a date the user chooses, such as recording
-- yesterday's electricity bill this morning.
-- ============================================================================

alter table public.sessions
  alter column business_date set default current_date;

comment on column public.sessions.business_date is
  'Tenant-local trading day, always derived server-side from the club timezone and cutoff. Client-supplied values are ignored.';

create or replace function app.sessions_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_timezone text;
  v_cutoff   time;
begin
  if tg_op = 'INSERT' then
    select t.timezone, t.business_day_cutoff
      into v_timezone, v_cutoff
      from public.tenants t
     where t.id = new.tenant_id;

    if v_timezone is null then
      raise exception 'unknown tenant %', new.tenant_id using errcode = '23503';
    end if;

    -- Derived, not defaulted: whatever the client sent is discarded.
    new.business_date := app.business_date(new.started_at, v_timezone, v_cutoff);

  elsif tg_op = 'UPDATE' then
    -- `started_at` is a recorded fact. Correcting one is an explicit,
    -- privileged action, not something an app screen may do.
    if new.started_at is distinct from old.started_at then
      raise exception 'session start time is immutable (session %)', old.id
        using errcode = '23514', hint = 'Cancel the session and start a new one instead.';
    end if;
    -- Once closed, a session's end time is fixed too.
    if old.ended_at is not null and new.ended_at is distinct from old.ended_at then
      raise exception 'session end time is immutable once the session is closed (session %)', old.id
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;
