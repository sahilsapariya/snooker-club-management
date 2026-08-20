# Club Desk

Multi-tenant SaaS for running snooker, pool and billiards clubs.

One React Native app, one Supabase project, one repository. Each tenant is one
physical club; their data is isolated from each other by PostgreSQL Row Level
Security, not by application code.

---

## Contents

1. [What this is](#1-what-this-is)
2. [Architecture](#2-architecture)
3. [Repository layout](#3-repository-layout)
4. [Prerequisites](#4-prerequisites)
5. [Getting started](#5-getting-started)
6. [Environment variables](#6-environment-variables)
7. [Commands](#7-commands)
8. [How authentication works](#8-how-authentication-works)
9. [How tenant isolation works](#9-how-tenant-isolation-works)
10. [How roles work](#10-how-roles-work)
11. [How theming works](#11-how-theming-works)
12. [Creating the first platform super admin](#12-creating-the-first-platform-super-admin)
13. [Creating a tenant](#13-creating-a-tenant)
14. [Database types](#14-database-types)
15. [Testing](#15-testing)
16. [Builds](#16-builds)
17. [Further reading](#17-further-reading)

---

## 1. What this is

A private operational product sold to clubs. Two audiences:

| Audience                          | What they do                                                                |
| --------------------------------- | --------------------------------------------------------------------------- |
| **Platform super admin** (you)    | Creates clubs, sets their branding, configuration and status, manages staff |
| **Club staff** (owner, reception) | Runs the floor: tables, sessions, sales, expenses, cash                     |

Club staff can never change the platform-controlled fields (name, logo,
colours, currency, timezone, status). That is enforced in the database, not by
hiding buttons — see [section 9](#9-how-tenant-isolation-works).

Two business rules the whole design protects:

- **Recorded time and billed time are different numbers.** A 60-minute booking
  played for 67 minutes stores 4020 seconds of actual duration, whatever the
  club chooses to charge. `sessions.actual_duration_seconds` is a generated
  column, so no client can overwrite it.
- **A session never ends by itself.** Reaching the booked time moves it to
  `TIME_COMPLETED`, an alertable state. Only a receptionist closes it.

---

## 2. Architecture

```
┌──────────────────────────────────────────────┐
│  apps/mobile        React Native + Expo 57    │
│                                              │
│   src/app/          Expo Router routes        │
│     (auth)/         signed out                │
│     (tenant)/       club staff                │
│     (platform)/     product owner             │
│                                              │
│   src/features/     feature modules           │
│     <feature>/api/     data access            │
│     <feature>/hooks/   TanStack Query wrappers│
│     <feature>/model/   types                  │
│                                              │
│   src/lib/          supabase, errors, logging │
│   src/theme/        tokens + tenant branding  │
│   src/components/ui design system             │
└────────────────────┬─────────────────────────┘
                     │  anon key only, HTTPS
┌────────────────────▼─────────────────────────┐
│  Supabase                                     │
│   auth.users  ──►  public.profiles            │
│                      ├─► platform_admins      │
│                      └─► tenant_memberships   │
│                            └─► tenants        │
│                                               │
│   Row Level Security on every table           │
│   SECURITY DEFINER helpers in schema `app`    │
└───────────────────────────────────────────────┘
```

State is split three ways and deliberately kept that way:

| Kind             | Lives in                          |
| ---------------- | --------------------------------- |
| **Auth state**   | Zustand (`src/stores/auth.store`) |
| **Server state** | TanStack Query                    |
| **UI state**     | Component state / Zustand         |

Anything that came out of Postgres belongs in the query cache, never in Zustand.

---

## 3. Repository layout

```
.
├── apps/
│   └── mobile/                 the only application
│       ├── src/
│       │   ├── app/            Expo Router file-based routes
│       │   ├── components/ui/  design system
│       │   ├── features/       auth, tables, notifications, platform
│       │   ├── lib/            supabase, errors, logger, query, format
│       │   ├── providers/      root providers
│       │   ├── stores/         Zustand stores
│       │   ├── theme/          tokens, colour maths, ThemeProvider
│       │   ├── types/          generated database types
│       │   └── constants/      validated env
│       ├── app.config.ts
│       ├── eas.json
│       └── .env.example
│
├── supabase/
│   ├── migrations/             ordered, reproducible schema
│   ├── tests/                  pgTAP: RLS, roles, business rules
│   ├── seed.sql                development fixtures
│   └── config.toml
│
├── docs/                       architecture, database, security, theming, ops
├── .github/workflows/ci.yml
├── package.json                workspace scripts
└── pnpm-workspace.yaml
```

Routes live under `src/app/` rather than a top-level `app/` — that is Expo's
current convention and keeps everything the app owns inside `src/`.

---

## 4. Prerequisites

| Tool    | Version               | Notes                                |
| ------- | --------------------- | ------------------------------------ |
| Node.js | 24 LTS (see `.nvmrc`) | `nvm use` picks it up                |
| pnpm    | 11+                   | `npm i -g pnpm`                      |
| Docker  | running               | required by the local Supabase stack |
| Expo Go | on a phone (optional) | fastest way to run the app           |

Android Studio / Xcode are only needed for native development builds, not for
the day-to-day loop.

---

## 5. Getting started

```bash
nvm use                 # Node 24
pnpm install

pnpm supabase:start     # starts Postgres, Auth, PostgREST, Studio (Docker)
pnpm db:reset           # applies every migration, then seeds development data

cp apps/mobile/.env.example apps/mobile/.env   # if you do not have one yet
pnpm dev                # Expo dev server
```

Then sign in with one of the seeded accounts (password `DevPassword123`):

| Email                        | Role                        |
| ---------------------------- | --------------------------- |
| `admin@snookerplatform.dev`  | platform super admin        |
| `owner@royalsnooker.dev`     | owner, Royal Snooker Club   |
| `reception@royalsnooker.dev` | receptionist, Royal Snooker |
| `owner@bluecue.dev`          | owner, Blue Cue Club        |
| `reception@bluecue.dev`      | receptionist, Blue Cue      |

Two clubs are seeded on purpose: tenant isolation is not observable with one.

> **Running on a physical device?** `127.0.0.1` in `.env` means the phone
> itself. Replace it with your machine's LAN address, e.g.
> `EXPO_PUBLIC_SUPABASE_URL=http://192.168.1.20:54321`.

> **Pointing at a hosted Supabase project instead?** It needs this schema:
> `pnpm supabase link --project-ref <ref>` then `pnpm db:push`. Until you do,
> the app will report that `public.tenants` does not exist.

---

## 6. Environment variables

Two files, two different jobs:

| File               | Purpose                                | Committed |
| ------------------ | -------------------------------------- | --------- |
| `apps/mobile/.env` | public config compiled into the app    | no        |
| `.env` (repo root) | CLI/CI credentials for hosted projects | no        |

The mobile app takes exactly two values, and **both are public**:

```
EXPO_PUBLIC_SUPABASE_URL=
EXPO_PUBLIC_SUPABASE_ANON_KEY=
```

Expo inlines `EXPO_PUBLIC_*` into the JavaScript bundle, so anyone with the APK
can read them. That is fine here: the anon key carries no authority of its own —
the `anon` role holds **zero** privileges on every table in this schema, and
every authenticated request is filtered by RLS.

**Never** place any of these under `apps/mobile/`:

- `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_SECRET_KEY` — bypasses RLS entirely
- the database password or any Postgres connection string
- Expo push access tokens, FCM server keys, APNs keys

`src/constants/env.ts` validates the configuration with Zod at startup and
fails loudly rather than booting into a broken state.

---

## 7. Commands

Run from the repository root.

| Command                | What it does                                                     |
| ---------------------- | ---------------------------------------------------------------- |
| `pnpm dev`             | Expo dev server (alias: `pnpm mobile`)                           |
| `pnpm mobile:android`  | build and run the Android dev build                              |
| `pnpm mobile:ios`      | build and run the iOS dev build (macOS)                          |
| `pnpm mobile:web`      | run in a browser — handy for quick UI work                       |
| `pnpm mobile:prebuild` | generate the native `android/` and `ios/` projects               |
| `pnpm doctor`          | Expo project diagnostics                                         |
| `pnpm supabase:start`  | start the local Supabase stack                                   |
| `pnpm supabase:stop`   | stop it                                                          |
| `pnpm supabase:status` | show local URLs and keys                                         |
| `pnpm db:reset`        | drop, re-apply every migration, re-seed                          |
| `pnpm db:migrate`      | apply pending migrations without dropping                        |
| `pnpm db:push`         | apply migrations to the linked hosted project                    |
| `pnpm db:diff -- name` | generate a migration from local schema drift                     |
| `pnpm db:lint`         | Postgres static analysis of the schema                           |
| `pnpm db:test`         | run the pgTAP suite (RLS, roles, business rules)                 |
| `pnpm db:types`        | regenerate `src/types/database.types.ts` from the local database |
| `pnpm typecheck`       | `tsc --noEmit`                                                   |
| `pnpm lint`            | ESLint, zero warnings tolerated                                  |
| `pnpm test`            | Jest unit tests                                                  |
| `pnpm format`          | Prettier write                                                   |
| `pnpm format:check`    | Prettier check                                                   |
| `pnpm verify`          | format:check + lint + typecheck + test                           |
| `pnpm verify:db`       | db:lint + db:test                                                |

---

## 8. How authentication works

Supabase Auth, email + password. Self-signup is **disabled**
(`supabase/config.toml`): accounts are provisioned by the platform admin.

The session token is stored in the OS keychain via `expo-secure-store`. Supabase
sessions routinely exceed SecureStore's ~2 KB per-entry limit, so
`src/lib/supabase/secure-storage.ts` transparently splits them across entries
and reassembles them on read. A partially written value is discarded rather
than returned truncated.

After sign-in, `resolveSessionContext()` asks three questions the user is
allowed to ask, and RLS decides what comes back:

```
auth.uid()
   ├─ profiles          → is the account active?
   ├─ platform_admins   → is this a platform operator?
   └─ tenant_memberships → which club, and in what role?
        └─ tenants      → status + branding
```

The client never sends a tenant id or a role and asks to be trusted. The result
is one closed union (`AppSessionState`) covering every case:

`loading` · `unauthenticated` · `error` · `account-disabled` · `no-tenant` ·
`tenant-suspended` · `platform-admin` · `tenant-user`

`src/app/index.tsx` switches on it once, so no screen can forget a branch.

---

## 9. How tenant isolation works

Four independent layers. Any one of them failing is not enough to leak data.

**1. Row Level Security on every table.** Policies are written in terms of
SECURITY DEFINER helpers in the non-exposed `app` schema:

```sql
app.is_platform_admin()          app.can_read_tenant(tenant_id)
app.get_user_tenant_id()         app.can_operate_tenant(tenant_id)
app.has_tenant_role(id, roles…)  app.can_manage_tenant(tenant_id)
```

They read membership themselves, so a policy never recurses into the table it
protects, and they are `STABLE` so Postgres evaluates them once per statement.

**2. Composite foreign keys.** Child rows reference their parent as
`(tenant_id, parent_id)`, with `unique (tenant_id, id)` on the parent. A row
_structurally cannot_ point at another tenant's row, even if a policy is wrong.

**3. Grants.** `anon` holds nothing. `authenticated` gets exactly
`SELECT, INSERT, UPDATE, DELETE` — Supabase's stock defaults also hand out
`TRUNCATE`, which ignores RLS completely, and migration `0011` strips it. The
stock ledger and the audit log have `UPDATE`/`DELETE` revoked outright.

**4. `public.tenants` is not writable by any client role.** Not by club staff,
and not by the platform admin either — they use SECURITY DEFINER RPCs
(`platform_create_tenant`, `platform_update_tenant`,
`platform_set_tenant_status`) that re-check authority inside the database. This
is what makes "club staff cannot change their own branding" a property of the
privilege system rather than of one policy being written correctly.

Route guards are UX, not security. All of the above is verified by
`pnpm db:test` — 119 assertions covering cross-tenant reads, cross-tenant
writes, role escalation, disabled accounts, suspended tenants and privilege
shape. See [docs/security.md](docs/security.md).

---

## 10. How roles work

| Role                   | Where it lives       | Can do                                                      |
| ---------------------- | -------------------- | ----------------------------------------------------------- |
| `PLATFORM_SUPER_ADMIN` | `platform_admins`    | manage tenants, branding, configuration, status, staff      |
| `TENANT_OWNER`         | `tenant_memberships` | everything operational + club configuration, pricing, staff |
| `TENANT_RECEPTIONIST`  | `tenant_memberships` | daily operations: sessions, sales, expenses, cash           |

Platform operators are deliberately **read-only over a club's books** — sessions,
session items, expenses, cash closings and stock. They administer clubs; they do
not quietly edit them.

A user belongs to one club today, enforced by a partial unique index. The
membership table is many-to-many, so supporting multi-club staff later means
dropping that one index — not a redesign.

---

## 11. How theming works

The platform admin sets one brand colour per club. Everything else is derived.

```
tenants.primary_color ──► buildTheme(branding, scheme) ──► semantic tokens
                                                             background
                                                             surface / surfaceElevated
                                                             textPrimary / Secondary / Muted
                                                             primary / primaryForeground
                                                             primaryContainer / onPrimaryContainer
                                                             border, success, warning, error, info
```

Components only ever reference semantic token names, so the same screen renders
an emerald club, a midnight-black club and a burgundy club with no component
change. Six presets ship (`emerald`, `midnight`, `ocean`, `amber`, `burgundy`,
`violet`); an explicit `primary_color` overrides the preset.

Two rules the tests enforce (`src/theme/build-theme.test.ts`):

- **Contrast is computed, not assumed.** Foregrounds are chosen by WCAG relative
  luminance and nudged until they hit 4.5:1. A club that picks pale amber still
  gets legible text.
- **Status colours are never derived from the brand.** Red has to mean "unpaid"
  in every club, including one whose brand colour is red.

Both light and dark schemes are generated. See [docs/theming.md](docs/theming.md).

---

## 12. Creating the first platform super admin

Chicken-and-egg by design: only a `SUPER_ADMIN` can grant platform authority, so
the first one is created out of band.

**Local development** — already seeded as `admin@snookerplatform.dev`.

**A hosted project:**

1. Create the user in the Supabase dashboard → Authentication → Users →
   _Add user_. Use a real address and a strong password.
2. In the SQL editor:

   ```sql
   insert into public.platform_admins (user_id, role, notes)
   select id, 'SUPER_ADMIN', 'Product owner'
   from auth.users
   where email = 'you@yourdomain.com'
   on conflict (user_id) do update set is_active = true;
   ```

3. Sign in on the app. You land on the platform Clubs screen.

Authority is a row, not a hard-coded email — revoking it is an `UPDATE`.

---

## 13. Creating a tenant

As a signed-in platform admin, from the SQL editor or via the app's RPC:

```sql
select public.platform_create_tenant(
  p_name          => 'Royal Snooker Club',
  p_slug          => 'royal-snooker',
  p_primary_color => '#059669',
  p_currency_code => 'INR',
  p_timezone      => 'Asia/Kolkata'
);
```

A trigger provisions the new club automatically with billing settings, the three
default table types (Pool Small, Pool Regular, Snooker) and the default expense
and product categories.

Then add staff — the account must already exist in Supabase Auth:

```sql
select public.add_tenant_member(
  '<tenant-uuid>', 'owner@theirclub.com', 'OWNER'
);
select public.add_tenant_member(
  '<tenant-uuid>', 'reception@theirclub.com', 'RECEPTIONIST'
);
```

`add_tenant_member` is callable by the club's own owner too, so an owner can add
their own receptionists without you.

---

## 14. Database types

`apps/mobile/src/types/database.types.ts` is generated, not written:

```bash
pnpm db:types            # from the local stack
pnpm db:types:remote     # from the linked hosted project
```

Regenerate it after every migration and commit the result. The app has no
`any` casts around database access; a schema change that breaks the client shows
up in `pnpm typecheck`.

---

## 15. Testing

```bash
pnpm test        # Jest: theme contrast, money, durations, secure storage, errors, session states
pnpm db:test     # pgTAP: tenant isolation, role authorization, business rules
```

The database suite is the important one. It runs as the `authenticated` Postgres
role, because running as `postgres` would prove nothing — that role has
`BYPASSRLS`. Three files:

| File                             | Covers                                                         |
| -------------------------------- | -------------------------------------------------------------- |
| `01_tenant_isolation.test.sql`   | club A cannot read, write or reference club B, by any route    |
| `02_role_authorization.test.sql` | what each role may do; escalation attempts; privilege shape    |
| `03_business_rules.test.sql`     | actual vs billable duration, price snapshots, the stock ledger |

---

## 16. Builds

EAS profiles are configured in `apps/mobile/eas.json`. Nothing here requires a
paid Apple or Google account for local development.

```bash
pnpm mobile:prebuild                  # generate native projects
eas build -p android --profile preview        # installable APK
eas build -p android --profile production     # AAB for Play
eas build -p ios --profile production         # requires an Apple account
```

`android/` and `ios/` are git-ignored: they are generated by `expo prebuild`
(Continuous Native Generation) and should not be hand-edited.

Push notifications need a development build, not Expo Go, and an EAS project id
(`eas init`). Everything else in this foundation runs in Expo Go.

---

## 17. Further reading

| Document                                       | Contents                                             |
| ---------------------------------------------- | ---------------------------------------------------- |
| [docs/architecture.md](docs/architecture.md)   | module boundaries, state strategy, adding a feature  |
| [docs/database.md](docs/database.md)           | schema tour, money and time representation           |
| [docs/security.md](docs/security.md)           | the four isolation layers, threat notes, checklist   |
| [docs/theming.md](docs/theming.md)             | token reference and how derivation works             |
| [docs/operations.md](docs/operations.md)       | provisioning clubs and staff, suspension, migrations |
| [docs/notifications.md](docs/notifications.md) | push architecture and the delivery worker            |
