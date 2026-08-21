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
5. [Running it locally](#5-running-it-locally)
6. [Environment variables](#6-environment-variables)
7. [Commands](#7-commands)
8. [How authentication works](#8-how-authentication-works)
9. [How tenant isolation works](#9-how-tenant-isolation-works)
   - [9a. One owner, many clubs](#9a-one-owner-many-clubs)
10. [How roles work](#10-how-roles-work)
11. [How theming works](#11-how-theming-works)
12. [Creating the first platform super admin](#12-creating-the-first-platform-super-admin)
13. [Creating a club and assigning an owner](#13-creating-a-club-and-assigning-an-owner)
14. [Database types](#14-database-types)
15. [Testing](#15-testing)
16. [Builds](#16-builds)
17. [Further reading](#17-further-reading)

---

## 1. What this is

A private operational product sold to club owners. The hierarchy is four levels
deep, and every design decision in the repository follows from it:

```
PLATFORM  ── you. Creates owners' clubs, brands them, suspends them.
   │
   └── OWNER  ── buys the product. May run ONE club or MANY, from one login.
          │
          └── CLUB  ── a physical venue. Its own tables, prices, staff, books.
                 │
                 └── RECEPTIONIST  ── works at exactly one club.
```

| Audience                 | What they do                                                                      |
| ------------------------ | --------------------------------------------------------------------------------- |
| **Platform super admin** | Creates clubs, assigns owners, sets branding and status. Never touches club books |
| **Club owner**           | Configures their clubs: tables, staff, prices, billing rules. Reads the books     |
| **Receptionist**         | Runs the floor: tables, sessions, sales, expenses, cash                           |

Three boundaries hold this together, and all three are enforced by Postgres
rather than by hiding buttons:

- **Club staff cannot change platform-controlled fields** (name, logo, colours,
  currency, timezone, status). `public.tenants` has INSERT, UPDATE and DELETE
  revoked from the `authenticated` role entirely.
- **The platform cannot change how a club charges.** Billing settings, pricing
  rules, tables and products require `app.is_tenant_owner(tenant_id)` — which a
  platform admin is not. What a club charges is the club's commercial decision.
- **An owner reaches their clubs and nothing else.** `app.tenant_ids()` returns
  every club the caller holds an active membership in, and every RLS policy asks
  whether the caller is a member of the tenant a _row_ belongs to — never what
  the client claims to be looking at.

See [section 9](#9-how-tenant-isolation-works) and
[section 9a](#9a-one-owner-many-clubs).

### What works today

| Area                                                  | State                                                          |
| ----------------------------------------------------- | -------------------------------------------------------------- |
| Sign in, roles, club resolution, theming              | done                                                           |
| Tables floor view with live occupancy                 | done                                                           |
| Session lifecycle: start, time-up, close, cancel      | done                                                           |
| Configurable billing engine                           | done                                                           |
| Food and drink on a bill, with stock ledger           | done                                                           |
| Payments: full, partial, discount, waive              | done                                                           |
| Expenses and cash-drawer reconciliation               | done                                                           |
| Reports: revenue, tables, products, expenses, debts   | done                                                           |
| Owner configuration of products and pricing           | done                                                           |
| Multi-club ownership: selection, switching, isolation | done                                                           |
| Owner configuration of tables and staff               | done                                                           |
| Owner configuration of billing rules                  | done                                                           |
| Per-club audit trail                                  | done                                                           |
| Platform admin: owners, clubs, create, brand, assign  | done                                                           |
| Push notification delivery                            | not built (see [docs/notifications.md](docs/notifications.md)) |
| Equipment screens                                     | not built                                                      |
| Creating login accounts from inside the app           | not built, by design — needs the service role                  |

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
│     select-club     signed in, choosing       │
│     (tenant)/       club staff, one club      │
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

| Kind             | Lives in                                 |
| ---------------- | ---------------------------------------- |
| **Auth state**   | Zustand (`src/stores/auth.store`)        |
| **Active club**  | Zustand (`src/stores/active-club.store`) |
| **Server state** | TanStack Query                           |
| **UI state**     | Component state / Zustand                |

Anything that came out of Postgres belongs in the query cache, never in Zustand.

The active club is the one exception worth calling out, and it is not an
exception to the rule above: it holds a _choice_, not data. It decides what the
app shows, never what the database allows. Anyone can put any uuid in it; RLS is
what makes that useless.

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

| Tool        | Version               | Check with         | Notes                                  |
| ----------- | --------------------- | ------------------ | -------------------------------------- |
| **Node.js** | 24 LTS (see `.nvmrc`) | `node -v`          | Node 18 is EOL and **will not work**   |
| **pnpm**    | 11+                   | `pnpm -v`          | `npm i -g pnpm`                        |
| **Docker**  | running               | `docker ps`        | the local Supabase stack is containers |
| Expo Go     | **54.x** — see below  | app version screen | must match the project's SDK exactly   |

Android Studio / Xcode are only needed for native development builds, not for
the day-to-day loop.

> **Expo Go and the SDK must match exactly.** This project is on **Expo SDK 54**,
> so you need **Expo Go 54.x** (since SDK 54, Expo Go's version number _is_ the
> SDK number). Opening it in a newer or older Expo Go gives
> _"Project is incompatible with this version of Expo Go"_.
>
> The stores only carry the newest Expo Go, and newer builds raise the minimum
> Android version — so a phone that cannot update past 54.x will report "no
> update available" and still be correct. That is why the SDK is pinned here
> rather than kept on the latest release.
>
> Check yours: **Settings → Apps → Expo Go → version**, or the Expo Go profile
> screen.
>
> To move off this constraint entirely, switch to a development build
> (`eas build --profile development`) — it is tied to your project rather than
> to a store app, and it is required for push notifications anyway.

> **If `node -v` shows anything below 24**, your system Node is too old. This
> repo pins the version in `.nvmrc`:
>
> ```bash
> nvm install    # first time only - reads .nvmrc
> nvm use        # in the repo root
> ```
>
> **If that says `nvm: command not found`**, nvm is not loaded in your shell.
> It is a shell _function_, not a program, so `npx nvm` cannot work either
> (npm hosts a placeholder package that just points you at nvm.sh). A common
> cause is having the nvm lines in `~/.bashrc` while using zsh, which never
> reads that file. Fix it once:
>
> ```bash
> cat >> ~/.zshrc <<'SETUP'
> export NVM_DIR="$HOME/.nvm"
> [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
> [ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"
> SETUP
> exec zsh                 # reload the shell
> nvm alias default 24     # so new terminals start on the right version
> ```
>
> That last line matters: global npm packages such as pnpm are installed
> **per Node version**, so a terminal that opens on a different version will
> report `pnpm: command not found`.

---

## 5. Running it locally

### 5.1 One-time setup

```bash
cd snooker-club-management
nvm use                                          # Node 24
pnpm install                                     # ~1 min

cp apps/mobile/.env.example apps/mobile/.env     # public config, git-ignored
```

Make sure Docker is actually running (`docker ps` should not error), then:

```bash
pnpm supabase:start
```

The first run downloads several GB of images and takes a few minutes. Later
runs take seconds. On a fresh volume this also **applies every migration and
runs `seed.sql` automatically**, so you have a working database with two clubs
in it when it finishes.

`pnpm supabase:status` prints the local URLs and keys at any time.

### 5.2 Every day after that

Two terminals, both from the repo root:

```bash
# terminal 1 - backend
nvm use && pnpm supabase:start

# terminal 2 - app
nvm use && pnpm dev
```

Metro starts on **http://localhost:8081**. In that terminal press:

| Key | Opens                                           |
| --- | ----------------------------------------------- |
| `w` | browser — **works immediately, no extra setup** |
| `a` | Android emulator (needs Android Studio)         |
| `i` | iOS simulator (macOS only)                      |
| `r` | reload the app                                  |
| `j` | open the debugger                               |

Or scan the QR code with **Expo Go** on your phone.

### 5.3 Point the app at the right address

`EXPO_PUBLIC_SUPABASE_URL` in `apps/mobile/.env` has to be reachable **from
wherever the app is running**, which is not always your laptop:

| Running on             | `EXPO_PUBLIC_SUPABASE_URL`   | Why                                              |
| ---------------------- | ---------------------------- | ------------------------------------------------ |
| Browser (`w`)          | `http://127.0.0.1:54321`     | same machine                                     |
| iOS simulator (`i`)    | `http://127.0.0.1:54321`     | shares the host network                          |
| Android emulator (`a`) | `http://10.0.2.2:54321`      | `10.0.2.2` is the emulator's alias for your host |
| **Physical phone**     | `http://<your-LAN-IP>:54321` | `127.0.0.1` on a phone means _the phone_         |

Find your LAN IP:

```bash
# Linux
ip -4 addr show scope global | grep -oP 'inet \K[\d.]+'
# macOS
ipconfig getifaddr en0
```

```bash
# apps/mobile/.env  - example for a physical device
EXPO_PUBLIC_SUPABASE_URL=http://192.168.1.20:54321
```

> **Restart Metro after editing `.env`.** Expo inlines `EXPO_PUBLIC_*` into the
> bundle at build time; it is not read at runtime, so a live-reload will not
> pick it up. Use `pnpm --filter @snooker/mobile start:clear` to also drop the
> Metro cache.

Phone and laptop must be on the same Wi-Fi, and your firewall must allow ports
`8081` and `54321`.

### 5.4 Sign in

All seeded accounts use the password **`DevPassword123`**:

| Email                        | Role                                               |
| ---------------------------- | -------------------------------------------------- |
| `admin@snookerplatform.dev`  | platform super admin, no club                      |
| `owner@royalsnooker.dev`     | owner of **two** clubs: Royal Snooker + Cue Lounge |
| `reception@royalsnooker.dev` | receptionist, Royal Snooker                        |
| `owner@bluecue.dev`          | owner, Blue Cue Club                               |
| `reception@bluecue.dev`      | receptionist, Blue Cue                             |

Three clubs are seeded on purpose:

- Two are the minimum before tenant isolation is observable at all. Sign in as
  the two receptionists side by side and you will see completely different data.
- The third gives one owner two clubs, which is what makes the club selector,
  the club switcher and per-club cache isolation exercisable without
  hand-building data first. Sign in as `owner@royalsnooker.dev` and you land on
  the selector; the two clubs bill differently and are different colours.

There is **no sign-up screen** — self-registration is disabled by design.
Accounts are provisioned by the platform admin; see
[docs/operations.md](docs/operations.md).

### 5.5 Stopping everything

```bash
# terminal 2: Ctrl+C   (stops Metro)
pnpm supabase:stop     # stops the containers, keeps your data
```

`supabase:stop` backs the database up, so the next `supabase:start` restores
exactly where you left off. To throw the data away and start clean instead:

```bash
pnpm db:reset          # re-runs every migration + seed.sql
```

### 5.6 When something goes wrong

| Symptom                                                 | Cause and fix                                                                                                                                                                                                                 |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Project is incompatible with this version of Expo Go`  | Your Expo Go major version must equal the project's SDK (currently **54**). Check **Settings → Apps → Expo Go → version**. If your phone cannot install Expo Go 54.x, use a development build instead.                        |
| `nvm: command not found`                                | nvm is not loaded in this shell. It is a shell function, so `npx nvm` cannot work. See the note in [§4](#4-prerequisites).                                                                                                    |
| `This version of pnpm requires at least Node.js v22.13` | You are on the system Node, not the nvm one. Run `nvm use` in the repo root. If that also fails, see the row above.                                                                                                           |
| `pnpm: command not found` after `nvm use`               | Global packages are installed per Node version. Either `npm i -g pnpm` on the version you switched to, or `nvm alias default 24`.                                                                                             |
| `Could not find the table 'public.tenants'`             | Migrations are not applied to whatever `.env` points at. Local: `pnpm db:reset`. Hosted: `pnpm supabase link --project-ref <ref> && pnpm db:push`.                                                                            |
| `permission denied for table …` for `anon`              | **Expected** — you are not signed in. `anon` has zero privileges by design.                                                                                                                                                   |
| `Network request failed` on a phone                     | `.env` still says `127.0.0.1`. See [5.3](#53-point-the-app-at-the-right-address).                                                                                                                                             |
| `Email logins are disabled`                             | `[auth.email] enable_signup` in `supabase/config.toml` got set to `false`. Despite the name it disables the email _provider_, not just signup. It must stay `true`; self-signup is blocked by `enable_signup` under `[auth]`. |
| `Invalid app configuration` at startup                  | `apps/mobile/.env` is missing or incomplete. Copy `.env.example` and restart Metro.                                                                                                                                           |
| `Error: listen EADDRINUSE :::8081`                      | An old Metro is still running: `pkill -f "expo start"`.                                                                                                                                                                       |
| `React Native DevTools … chrome-sandbox` error on Linux | Harmless. An optional debugging tool cannot start; the app is unaffected.                                                                                                                                                     |
| Stale or bizarre bundling errors                        | `pnpm --filter @snooker/mobile start:clear`                                                                                                                                                                                   |
| Docker errors from `supabase:start`                     | Docker is not running, or a previous stack is stuck: `pnpm supabase:stop` then start again.                                                                                                                                   |

### 5.7 Useful local URLs

| What                            | URL                                                       |
| ------------------------------- | --------------------------------------------------------- |
| Metro / app                     | http://localhost:8081                                     |
| Supabase API                    | http://127.0.0.1:54321                                    |
| Supabase Studio (browse the DB) | http://127.0.0.1:54323                                    |
| Mail catcher (password resets)  | http://127.0.0.1:54324                                    |
| Postgres                        | `postgresql://postgres:postgres@127.0.0.1:54322/postgres` |

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
`tenant-suspended` · `platform-admin` · `club-selection` · `tenant-user`

`src/app/index.tsx` switches on it once, so no screen can forget a branch.

`club-selection` is what multi-club ownership added: signed in, several clubs
reachable, none chosen yet. A user with exactly one club never enters it.

---

## 9. How tenant isolation works

Four independent layers. Any one of them failing is not enough to leak data.

**1. Row Level Security on every table.** Policies are written in terms of
SECURITY DEFINER helpers in the non-exposed `app` schema:

```sql
app.is_platform_admin()          app.can_read_tenant(tenant_id)
app.tenant_ids()                 app.can_operate_tenant(tenant_id)
app.has_tenant_role(id, roles…)  app.can_manage_tenant(tenant_id)
app.is_tenant_owner(tenant_id)   app.shares_tenant_with(user_id)
```

Note the shape of the question each one asks: _is the caller a member of the
tenant this row belongs to_. Never _what is the caller's tenant_. That
distinction is why supporting one owner across many clubs required no policy
rewrite. (`app.get_user_tenant_id()` still exists but is deprecated — it returns
NULL for anyone with more than one club, rather than picking one arbitrarily.)

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
(`platform_create_club`, `platform_update_tenant`, `platform_set_tenant_status`,
`platform_assign_owner`, `platform_set_owner_active`) that re-check authority
inside the database. This is what makes "club staff cannot change their own
branding" a property of the privilege system rather than of one policy being
written correctly.

Route guards are UX, not security. All of the above is verified by
`pnpm db:test` — 212 assertions covering cross-tenant reads, cross-tenant
writes, role escalation, disabled accounts, suspended tenants, multi-club
ownership and privilege shape. See [docs/security.md](docs/security.md).

---

## 9a. One owner, many clubs

An owner may run any number of clubs from a single login. A receptionist works
at exactly one. Both facts are enforced in the database, by a single partial
unique index (migration `0015`):

```sql
create unique index tenant_memberships_single_active_club_for_staff
  on public.tenant_memberships (user_id)
  where status = 'ACTIVE' and role = 'RECEPTIONIST';
```

Everything else was already multi-club capable: `tenant_memberships` has always
been many-to-many, and `app.tenant_ids()` has always returned a set.

**In the app.** Three inputs are kept deliberately separate:

| Input        | Kind         | Answers                                      |
| ------------ | ------------ | -------------------------------------------- |
| auth session | client state | who is signed in                             |
| identity     | server state | which clubs they may reach — keyed by _user_ |
| active club  | client state | which of those they are operating            |

Keying identity by user rather than by club is what makes switching cheap:
changing club refetches that club's data, never the membership set.

`resolveActiveClub(clubs, storedTenantId)` is a pure function with four
outcomes — no clubs → nothing; stored club still reachable → it; exactly one
club → it, no selector; several → nothing, show the selector. A club that has
been suspended, or that the user has been removed from, is discarded rather than
silently honoured.

**Cache isolation.** Every club-scoped query key starts
`['tenant', tenantId, …]`, so two clubs' data physically cannot share an entry.
On switch, the outgoing club's entries are **removed**, not invalidated — an
invalidated entry is still served while it refetches, which is exactly the
"club A's takings under club B's name" flash worth preventing. Platform data
lives under `['platform', …]` and survives a switch, because it is not club data.

**What is per club, never merged:** tables, staff, prices, billing rules,
sessions, payments, expenses, cash closings, notifications, reports, the audit
trail, and the colour of the entire app.

---

## 10. How roles work

| Role                   | Where it lives       | Can do                                                         |
| ---------------------- | -------------------- | -------------------------------------------------------------- |
| `PLATFORM_SUPER_ADMIN` | `platform_admins`    | create clubs, assign owners, brand, suspend, attach staff      |
| `TENANT_OWNER`         | `tenant_memberships` | everything operational + tables, staff, pricing, billing rules |
| `TENANT_RECEPTIONIST`  | `tenant_memberships` | daily operations: sessions, sales, expenses, cash              |

Two exclusions are load-bearing and easy to get backwards:

- Platform operators are **read-only over a club's books** — sessions, session
  items, expenses, cash closings and stock. They administer clubs; they do not
  quietly edit them.
- Platform operators **cannot configure a club** either. Since migration `0015`,
  tables, table types, pricing rules, products, product categories, equipment,
  expense categories and billing settings all require
  `app.is_tenant_owner(tenant_id)`. How a club charges is the club's decision.

And in the other direction: an owner **cannot mint another owner**.
`add_tenant_member` refuses the `OWNER` role unless `app.is_platform_admin()`.
Ownership is a commercial relationship the platform sells; it is not something a
login can hand to itself.

Access is revoked by disabling a membership, never by deleting it — a former
receptionist's name still appears against every session they opened.
`set_membership_status` enforces two rules RLS cannot express: a club must keep
at least one active owner, and nobody may revoke their own access.

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

## 13. Creating a club and assigning an owner

Normally done in the app: **Platform → Create a club**. The owner must already
have a Supabase Auth account — creating login credentials needs the service-role
key, which never reaches the app. See [docs/operations.md](docs/operations.md)
for creating the account first.

The same thing from SQL, as a signed-in platform admin:

```sql
select public.platform_create_club(
  p_name          => 'Royal Snooker Club',
  p_slug          => 'royal-snooker',
  p_owner_email   => 'owner@theirclub.com',
  p_primary_color => '#059669',
  p_currency_code => 'INR',
  p_timezone      => 'Asia/Kolkata',
  p_status        => 'TRIAL'
);
```

One transaction does all of it: creates the tenant, provisions it (billing
settings, the three default table types, default expense and product
categories), attaches the owner and writes the audit entry. There is no state in
which a club exists but has no owner — if the email has no account the function
raises `P0002` with a hint and nothing is created.

To move a club to a new owner, or add a second one:

```sql
-- the club changed hands: the previous owner loses access
select public.platform_assign_owner('<tenant-uuid>', 'new@owner.com', true);
-- a partnership: both keep access
select public.platform_assign_owner('<tenant-uuid>', 'second@owner.com', false);
```

Staff are added by the club's own owner, from **More → Staff** — you do not need
to be involved:

```sql
select public.add_tenant_member(
  '<tenant-uuid>', 'reception@theirclub.com', 'RECEPTIONIST'
);
```

`add_tenant_member` refuses the `OWNER` role unless the caller is a platform
admin, and refuses a receptionist who is already active at another club.

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
pnpm test        # Jest: 194 assertions — theme contrast, money, durations, secure
                 # storage, errors, session states, club resolution, cache isolation
pnpm db:test     # pgTAP: 212 assertions — isolation, roles, business rules,
                 # multi-club ownership, platform administration
```

The database suite is the important one. It runs as the `authenticated` Postgres
role, because running as `postgres` would prove nothing — that role has
`BYPASSRLS`. Five files:

| File                                  | Covers                                                                |
| ------------------------------------- | --------------------------------------------------------------------- |
| `01_tenant_isolation.test.sql`        | club A cannot read, write or reference club B, by any route           |
| `02_role_authorization.test.sql`      | what each role may do; escalation attempts; privilege shape           |
| `03_business_rules.test.sql`          | actual vs billable duration, price snapshots, the stock ledger        |
| `04_multi_club.test.sql`              | one owner across many clubs; a receptionist pinned to one; suspension |
| `05_platform_administration.test.sql` | platform-only reads, club creation, staffing guards, the audit trail  |

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

| Document                                                                               | Contents                                             |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| [docs/architecture.md](docs/architecture.md)                                           | module boundaries, state strategy, adding a feature  |
| [docs/database.md](docs/database.md)                                                   | schema tour, money and time representation           |
| [docs/security.md](docs/security.md)                                                   | the four isolation layers, threat notes, checklist   |
| [docs/theming.md](docs/theming.md)                                                     | token reference and how derivation works             |
| [docs/operations.md](docs/operations.md)                                               | provisioning clubs and staff, suspension, migrations |
| [docs/notifications.md](docs/notifications.md)                                         | push architecture and the delivery worker            |
| [docs/audit-2026-08-21.md](docs/audit-2026-08-21.md)                                   | a full screen-by-screen audit of the app             |
| [docs/multi-club-restructure-2026-08-21.md](docs/multi-club-restructure-2026-08-21.md) | the multi-club ownership restructure, in full        |
