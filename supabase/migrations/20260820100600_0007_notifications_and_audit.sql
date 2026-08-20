-- ============================================================================
-- 0007 · Notifications, push tokens and the activity log
-- ============================================================================

-- ---------------------------------------------------------------------------
-- notifications — tenant-scoped in-app inbox
-- ---------------------------------------------------------------------------
-- `recipient_user_id IS NULL` means "everyone at this club" (e.g. a low-stock
-- warning). Targeted rows are used for things only the owner should see.
create table public.notifications (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants (id) on delete cascade,
  recipient_user_id uuid references public.profiles (id) on delete cascade,
  type              public.notification_type not null,
  title             text not null,
  body              text,
  metadata          jsonb not null default '{}'::jsonb,
  entity_type       text,
  entity_id         uuid,
  read_at           timestamptz,
  created_at        timestamptz not null default now(),

  constraint notifications_title_not_blank check (length(trim(title)) > 0),
  constraint notifications_metadata_is_object check (jsonb_typeof(metadata) = 'object')
);

create index notifications_inbox_idx
  on public.notifications (tenant_id, recipient_user_id, created_at desc);
create index notifications_unread_idx
  on public.notifications (tenant_id, recipient_user_id)
  where read_at is null;

comment on column public.notifications.recipient_user_id is
  'NULL broadcasts to every active member of the tenant; a value targets one user.';

alter table public.notifications enable row level security;

-- ---------------------------------------------------------------------------
-- device_push_tokens — where to deliver a push
-- ---------------------------------------------------------------------------
-- Only the Expo push token lives here. No push credentials of any kind are
-- stored in, or shipped to, the mobile app: delivery is performed later by a
-- trusted server-side worker holding the Expo access token.
create table public.device_push_tokens (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles (id) on delete cascade,
  tenant_id       uuid references public.tenants (id) on delete cascade,
  expo_push_token text not null,
  platform        public.device_platform not null,
  device_id       text,
  device_name     text,
  app_version     text,
  is_active       boolean not null default true,
  last_seen_at    timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint device_push_tokens_unique unique (expo_push_token),
  constraint device_push_tokens_format
    check (expo_push_token ~ '^(ExponentPushToken|ExpoPushToken)\[[^]]+\]$')
);

create index device_push_tokens_user_idx on public.device_push_tokens (user_id) where is_active;
create index device_push_tokens_tenant_idx on public.device_push_tokens (tenant_id) where is_active;

create trigger device_push_tokens_set_updated_at
  before update on public.device_push_tokens
  for each row execute function app.set_updated_at();

alter table public.device_push_tokens enable row level security;

-- ---------------------------------------------------------------------------
-- activity_logs — append-only operational audit trail
-- ---------------------------------------------------------------------------
-- `action` is free text rather than an enum on purpose: new operational events
-- will be added continuously and should never require a type migration.
create table public.activity_logs (
  id             bigint generated always as identity primary key,
  -- NULL for platform-level events (tenant created, tenant suspended, ...).
  tenant_id      uuid references public.tenants (id) on delete cascade,
  actor_user_id  uuid references public.profiles (id) on delete set null,
  actor_role     text,
  action         text not null,
  entity_type    text,
  entity_id      uuid,
  summary        text,
  metadata       jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),

  constraint activity_logs_action_not_blank check (length(trim(action)) > 0),
  constraint activity_logs_metadata_is_object check (jsonb_typeof(metadata) = 'object')
);

create index activity_logs_tenant_idx on public.activity_logs (tenant_id, created_at desc);
create index activity_logs_entity_idx
  on public.activity_logs (entity_type, entity_id)
  where entity_id is not null;
create index activity_logs_actor_idx on public.activity_logs (actor_user_id, created_at desc);

comment on table public.activity_logs is
  'Append-only. UPDATE/DELETE are revoked at the grant level so a compromised client cannot rewrite history.';

alter table public.activity_logs enable row level security;
