# Architecture

## Stack

| Concern      | Choice                         | Why                                                              |
| ------------ | ------------------------------ | ---------------------------------------------------------------- |
| Runtime      | Expo SDK 57, React Native 0.86 | CNG, EAS builds, OTA updates; no hand-maintained native projects |
| Language     | TypeScript 6, strict           | plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`    |
| Navigation   | Expo Router 57                 | file-based, typed routes, deep links for free                    |
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

**Everything is Expo Go compatible.** That is a deliberate constraint on the
dependency list: the app can be run on a phone in seconds without a native
build. React Native's own `KeyboardAvoidingView` is used rather than
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

---

## State

| Kind         | Home                      | Examples                            |
| ------------ | ------------------------- | ----------------------------------- |
| Auth state   | Zustand `useAuthStore`    | Supabase session, signed-in status  |
| Server state | TanStack Query            | profile, membership, tenant, tables |
| UI state     | component state / Zustand | form values, sheet open, filters    |

The Supabase session is genuinely client state: restored from secure storage,
mutated by a subscription, read synchronously during navigation. Role, club and
profile are **server state** and live in the query cache keyed by user id — so
signing in as somebody else cannot show the previous user's club from memory.
`SIGNED_OUT` also calls `queryClient.clear()`.

Query keys are tenant-scoped (`['tenant', tenantId, 'tables']`), which makes
cache invalidation on club boundaries trivial and accidental cross-tenant cache
hits impossible.

---

## The session gate

`useAppSession()` combines the auth store and the resolved context into one
closed union:

```
loading · unauthenticated · error · account-disabled
no-tenant · tenant-suspended · platform-admin · tenant-user
```

`src/app/index.tsx` switches on it exhaustively and redirects. Modelling it as a
union rather than a bag of booleans means a new screen cannot forget that an
account might be disabled, and the compiler refuses to let it read `tenant`
outside the variants that have one.

Route groups follow the same split:

```
src/app/
├── index.tsx        the gate
├── (auth)/          signed out
├── (tenant)/        club staff: tables, sessions, alerts, settings
└── (platform)/      product owner: clubs, club detail
```

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

## Deliberate omissions

Scaffolded but not implemented, so the next stage lands in a shaped space:

- **Billing engine.** The rules are fully modelled
  (`tenant_billing_settings`, `pricing_rules`) and `plannedTimeProgress()`
  handles the elapsed-vs-booked arithmetic. The function that turns a session
  into a charge is not written.
- **Session workflow.** Start, add items, take payment, close.
- **Reports, inventory and expense screens.**
- **Push delivery.** Tokens are captured and stored; sending needs a server-side
  worker (see [notifications.md](notifications.md)).
- **Offline sync.** Query caching handles brief drops. Real offline-first is a
  separate design.

Not planned: a repository layer, a DTO layer, microservices, or a shared
`packages/` module until two consumers actually exist.
