# Architecture

## Stack

| Concern      | Choice                         | Why                                                              |
| ------------ | ------------------------------ | ---------------------------------------------------------------- |
| Runtime      | Expo SDK 54, React Native 0.81 | CNG, EAS builds, OTA updates; no hand-maintained native projects |
| Language     | TypeScript 5.9, strict         | plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`    |
| Navigation   | Expo Router 6                  | file-based, typed routes, deep links for free                    |
| Server state | TanStack Query 5               | caching, retry policy and invalidation in one place              |
| Client state | Zustand 5                      | small, no boilerplate, no context re-render storms               |
| Forms        | React Hook Form + Zod 4        | uncontrolled inputs, one schema for types and validation         |
| Backend      | Supabase (Postgres 17)         | RLS is the product's security model                              |
| Icons        | lucide-react-native            | tree-shakeable, one consistent set                               |
| Dates        | date-fns 4 + @date-fns/tz      | tenant-timezone rendering without a heavyweight dependency       |

**No UI framework.** The design system is ~15 components in
`src/components/ui`. Every club gets its own colours, so the components have to
read from theme tokens rather than a vendor's palette — adopting a framework
would mean fighting it on the one axis that matters most here.

**The SDK is pinned to what Expo Go supports.** SDK 54 is not the newest
release - it is the newest one the Expo Go build available on the team's
devices can run. Expo Go ships one client per SDK and only the latest is on
the stores, so a phone that cannot update past Expo Go 54.x cannot open an
SDK 55+ project at all. Bumping the SDK therefore has a hard prerequisite:
either everyone can install the matching Expo Go, or the team moves to
development builds (`eas build --profile development`), which are tied to your
project rather than to a store app and remove the constraint entirely.

**Everything else is Expo Go compatible too.** That is a deliberate constraint
on the dependency list: the app can be run on a phone in seconds without a
native build. React Native's own `KeyboardAvoidingView` is used rather than
`react-native-keyboard-controller` for exactly this reason. Push notifications
are the one feature that needs a development build.

---

## Directory boundaries

```
src/
├── app/            Expo Router routes. Composition only - no business logic.
├── components/ui/  Design system. Knows about theme tokens, nothing else.
├── features/       Feature modules. Where the product lives.
│   └── <feature>/
│       ├── api/        Supabase access. The only place queries are written.
│       ├── hooks/      TanStack Query wrappers over api/.
│       ├── components/ Feature-specific UI.
│       ├── model/      Types and pure predicates.
│       └── index.ts    The module's public surface.
├── lib/            Cross-cutting: supabase, errors, logger, query, format.
├── providers/      Root providers.
├── stores/         Zustand. Client state only.
├── theme/          Tokens, colour maths, ThemeProvider.
├── test-utils/     Render helper that supplies the real providers.
├── types/          Generated database types.
└── constants/      Validated environment.
```

Two rules:

1. **Routes compose, they do not compute.** A screen reads a hook, switches on
   the result and renders. If a screen starts doing arithmetic, that arithmetic
   belongs in the feature.
2. **Features talk through `index.ts`.** Reaching into
   `features/tables/api/tables.api` from another feature is a smell; import from
   `@/features/tables`.

There is no repository layer, no service layer and no DTO mapping. The generated
database types are the domain types. Adding a translation layer between them
would be work with no reader.

The feature list, as of the multi-club restructure:

| Feature         | Owns                                                      |
| --------------- | --------------------------------------------------------- |
| `auth`          | identity, the session union, club selection and switching |
| `platform`      | owners, clubs, branding, status, ownership assignment     |
| `staff`         | a club's roster: who works here and what they may reach   |
| `tables`        | the floor view, and the owner's table inventory           |
| `sessions`      | the session lifecycle, items, frames, close-and-pay       |
| `billing`       | the pure charge engine, and the club's billing settings   |
| `pricing`       | per-table-type rate rules                                 |
| `products`      | catalogue and stock                                       |
| `payments`      | money in: the ledger, debts, and settling one             |
| `expenses`      | money out, with correction                                |
| `cash`          | the daily till and its history                            |
| `reports`       | aggregates over a range                                   |
| `activity`      | the append-only audit trail                               |
| `notifications` | the in-app inbox and push registration                    |

---

## State

| Kind         | Home                         | Examples                             |
| ------------ | ---------------------------- | ------------------------------------ |
| Auth state   | Zustand `useAuthStore`       | Supabase session, signed-in status   |
| Active club  | Zustand `useActiveClubStore` | which of the caller's clubs is open  |
| Server state | TanStack Query               | profile, memberships, tenant, tables |
| UI state     | component state / Zustand    | form values, sheet open, filters     |

The Supabase session is genuinely client state: restored from secure storage,
mutated by a subscription, read synchronously during navigation. Role, clubs and
profile are **server state** and live in the query cache keyed by user id — so
signing in as somebody else cannot show the previous user's club from memory.
`SIGNED_OUT` also calls `queryClient.clear()`.

The active club is client state because it is a _choice_, not data. It decides
what the app shows and never what the database allows — anyone can put any uuid
in it, and RLS is what makes that useless. It is persisted so reopening the app
mid-shift returns you to where you were, and re-validated against live
memberships on every launch: a club you have been removed from, or that has been
suspended, is discarded rather than honoured.

Query keys are tenant-scoped (`['tenant', tenantId, 'tables']`), which makes
cache invalidation on club boundaries trivial and accidental cross-tenant cache
hits impossible. Platform data lives under `['platform', …]` so a club switch
cannot evict it.

### Switching club

Order matters, and `useSwitchClub` is the only place it happens:

1. **Remove** the outgoing club's entries — not invalidate. An invalidated entry
   is still served while it refetches, which is exactly the "club A's takings
   under club B's name and colours" flash worth preventing.
2. Record the new choice, and persist it.
3. Invalidate the incoming club, which may have been visited earlier this
   session and be stale.

Because identity (which clubs you may reach) is keyed by _user_ and club data by
_tenant_, switching refetches the club and never the membership set.

---

## The session gate

`useAppSession()` combines the auth store and the resolved context into one
closed union:

```
loading · unauthenticated · error · account-disabled · no-tenant
tenant-suspended · platform-admin · club-selection · tenant-user
```

`club-selection` is the multi-club case: signed in, several clubs reachable,
none chosen. `resolveActiveClub(clubs, stored)` decides — a pure function, so
every branch is testable without a store or a network:

| Situation                     | Result                       |
| ----------------------------- | ---------------------------- |
| no clubs                      | `null` → `no-tenant`         |
| stored club still reachable   | that club                    |
| stored club gone or suspended | fall through, and clear it   |
| exactly one reachable club    | that club, no selector shown |
| several reachable clubs       | `null` → `club-selection`    |

`src/app/index.tsx` switches on it exhaustively and redirects. Modelling it as a
union rather than a bag of booleans means a new screen cannot forget that an
account might be disabled, and the compiler refuses to let it read `tenant`
outside the variants that have one.

Route groups follow the same split:

```
src/app/
├── index.tsx        the gate
├── (auth)/          signed out
├── select-club.tsx  signed in, several clubs, none chosen
├── (tenant)/        club staff, in ONE club at a time
└── (platform)/      product owner: owners, clubs, branding
```

`(tenant)` renders `ActiveClubBar` above the tabs — in the shell, not on each
screen, so no screen can be built that forgets to say which club its numbers
belong to. The switch affordance only appears for someone with more than one.

---

## The ownership model

```
PLATFORM ──┬── OWNER A ──┬── CLUB 1 ── receptionists
           │             └── CLUB 2 ── receptionists
           └── OWNER B ───── CLUB 3 ── receptionists
```

`tenant_memberships` is the only thing that expresses this. There is no owners
table: **ownership is a membership with `role = 'OWNER'`**, which is why an
owner running four clubs needs no special case anywhere — they simply hold four
memberships.

That decision is what made the multi-club change small. Every RLS policy was
already written as _"is the caller a member of the tenant this row belongs to"_
rather than _"what is the caller's tenant"_, and `app.tenant_ids()` already
returned a set. One partial unique index was the only thing physically
preventing it.

### Who may do what to a club

| Action                                   | Platform | Owner | Receptionist |
| ---------------------------------------- | :------: | :---: | :----------: |
| Create a club, brand it, suspend it      |    ✓     |       |              |
| Assign or replace its owner              |    ✓     |       |              |
| Tables, pricing, products, billing rules |          |   ✓   |              |
| Add and remove receptionists             |    ✓     |   ✓   |              |
| Grant OWNER                              |    ✓     |       |              |
| Sessions, payments, expenses, cash       |          |   ✓   |      ✓       |
| Read the audit trail                     |    ✓     |   ✓   |              |
| Write to the audit trail                 |    ✓     |   ✓   |      ✓       |

The two blank cells that surprise people are deliberate. The platform **cannot**
configure a club — how it charges is its own commercial decision. And an owner
**cannot** mint another owner — that is the relationship the platform sells.

---

## Errors

Everything thrown by Supabase, the network or our own code is normalised into
`AppError` by `toAppError()`, which carries two messages:

- `message` / `userMessage` — written for the person holding the phone
- `technicalMessage` — written for us, logged, never rendered in production

`unwrap()` sits between every `api/` function and Supabase, so mapping and
logging happen in one place rather than at 40 call sites. SQLSTATEs this schema
actually raises are mapped deliberately: `42501` → permission, `23505` →
conflict, `23514` → "not allowed by this club's rules", `428C9` → "calculated
automatically".

`ErrorState` shows `technicalMessage` in development builds only.

---

## Logging

`src/lib/logger` — `debug` / `info` / `warn` / `error`, scoped children
(`logger.child('auth')`), level-filtered from `EXPO_PUBLIC_LOG_LEVEL`
(`debug` in development, `warn` otherwise). ESLint bans bare `console.log`.

The value is not the formatting; it is that every diagnostic goes through one
seam, so adding Sentry later is a single edit.

---

## Adding a feature

Take expenses as the example:

1. `supabase/migrations/` — schema, RLS policy, grants if unusual
2. `pnpm db:reset && pnpm db:test && pnpm db:types`
3. `src/features/expenses/api/expenses.api.ts` — typed reads/writes via `unwrap`
4. `src/features/expenses/hooks/use-expenses.ts` — query/mutation hooks with keys
   from `queryKeys`
5. `src/features/expenses/components/` — UI built from `@/components/ui`
6. `src/app/(tenant)/expenses.tsx` — route, plus a tab entry
7. `src/features/expenses/index.ts` — public surface
8. `pnpm verify`

Never add a `tenant_id` parameter that the client chooses. Read it from the
session; the database decides what that identity can reach.

---

## Money: two pure functions

Both live in `features/billing`, both have no clock, no database and no I/O, and
both are heavily unit-tested. That is deliberate: a mistake in either does not
crash anything, it silently charges the wrong amount for months.

**`calculateSessionCharge`** turns recorded time into a charge. Four
time-calculation modes, four rounding modes, grace period, four overtime modes,
minimum billable time, per-frame and flat-session pricing, custom slabs. It
produces `billable_duration_seconds` and never `actual_duration_seconds` - the
latter is a generated column Postgres refuses to accept a value for.

Grace semantics are a choice worth knowing: an overrun **inside** the grace is
forgiven entirely, and once the grace is exceeded, overtime is measured from the
end of the booking rather than the end of the grace. That creates a deliberate
cliff (65 min against a 60 min booking pays for 60; 66 min pays for 66), which
is how grace periods conventionally work.

**`settleSession`** turns "what is owed" and "what was handed over" into the row
the database expects. It exists because two check constraints have sharp edges:
a discount above the bill is rejected outright, and a `PAID` row without a
payment method is refused. It clamps and warns rather than letting a save fail
at the counter, and treats over-tendering as change rather than revenue.

## Pricing is snapshotted, not looked up

A session stores the pricing rule it started under in `pricing_snapshot`, and
`pricingRuleFromSnapshot()` rebuilds it when the bill is computed. Reading the
live rule instead would mean a club raising its rates at 8pm silently reprices
every session still running from 7pm. This is why editing prices mid-evening is
safe.

## Reporting

`features/reports` calls SQL functions that aggregate in Postgres
(`report_revenue_summary`, `report_daily_revenue`, `report_table_performance`,
`report_product_sales`, `report_expense_breakdown`) plus the
`v_outstanding_sessions` view.

All of them are **SECURITY INVOKER**. For a function that totals money this is
the whole ballgame: a definer function would add up another club's takings for
anyone who passed a different tenant id. The arguments are not the security
boundary; RLS is. `01_tenant_isolation.test.sql` points every report at another
club and asserts it returns nothing.

Ranges are expressed in the club's **business** calendar, so a club trading past
midnight does not see its late sessions land on the wrong day.

## Deliberate omissions

- **The Expo receipt pass.** `push-dispatch` reads delivery _tickets_, which
  catches the tokens Expo rejects outright. `DeviceNotRegistered` usually
  arrives in the later _receipt_, and polling for those needs somewhere to keep
  ticket ids between the send and the poll. Until it exists, some dead tokens
  stay active and are sent to harmlessly. See
  [notifications.md](notifications.md).
- **Equipment screens.** The schema and RLS exist; no UI yet.
- **Creating login accounts.** Making a Supabase Auth user needs the service
  role, which never reaches the app. Accounts are created in the dashboard or
  via the Admin API first; the app links them to clubs. `platform_create_club`
  and `add_tenant_member` both raise `P0002` with a hint rather than silently
  creating something half-made.
- **Offline sync.** Query caching handles brief drops. Real offline-first is a
  separate design.
- **Multi-club _staff_.** Owners span clubs; receptionists do not. A partial
  unique index (`tenant_memberships_single_active_club_for_staff`) enforces it.
  Relaxing that is one index, not a redesign — but the operational question
  ("whose shift is this?") should be answered first.

Not planned: a repository layer, a DTO layer, microservices, or a shared
`packages/` module until two consumers actually exist.

## Navigation

Five tabs, because a six or seven item bar makes every target too small to hit
one-handed at a counter:

```
Tables · Sessions · Cash · Alerts · More
```

Everything used occasionally is routable but hidden from the bar (`href: null`
in `(tenant)/_layout.tsx`) and reached from **More**:

```
reports · manage · settings · expenses · debts
tables-setup · staff · billing · activity        (owner only)
```

The tabs are the four things a receptionist touches during a shift. Owner-only
destinations are still _listed_ for a receptionist, marked as such, so they
learn the app has them and who to ask — rather than the app appearing to be
missing features. The screens show a locked state, and the database refuses the
write regardless of what the UI shows.
