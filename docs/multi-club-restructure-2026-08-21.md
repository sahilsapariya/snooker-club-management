# Multi-club ownership restructure — report

**Date:** 21 August 2026
**Commit:** `f53cf92` — _feat: restructure to platform → owner → club → staff ownership_
**Branch:** `main`

---

## 1. What was asked, and the shape of the answer

Restructure Club Desk from _one user → one club_ to **PLATFORM → OWNER (many clubs) → CLUB → receptionists**, with one owner login reaching several clubs — without rebuilding, without discarding the existing architecture, and without replacing working systems.

The most important finding came before any code was written: **the architecture was already ~90% multi-club capable.**

- `tenant_memberships` was already many-to-many.
- `app.tenant_ids()` already returned `setof uuid`.
- Every RLS policy already asked _"is the caller a member of the tenant this **row** belongs to"_ rather than _"what is the caller's tenant"_.
- Every TanStack Query key was already `['tenant', tenantId, …]`.

Exactly one object physically prevented multi-club ownership: a partial unique index, `tenant_memberships_single_active_per_user`. The fix was to narrow it to receptionists — not to redesign anything.

That single fact is why the instruction "do not rebuild" was easy to honour: **no RLS policy was rewritten to support multi-club ownership.** The policies were already correct; they had simply never been given a user with two memberships.

---

## 2. Database changes — four migrations

All four are applied locally and verified. Nothing was mutated outside a migration.

### `0015_multi_club_ownership`

Two distinct changes.

**(a) The index.**

```sql
drop index if exists public.tenant_memberships_single_active_per_user;

create unique index tenant_memberships_single_active_club_for_staff
  on public.tenant_memberships (user_id)
  where status = 'ACTIVE' and role = 'RECEPTIONIST';
```

An owner may hold any number of active memberships. A receptionist may hold one. Both are enforced by Postgres, not by the app.

**(b) A responsibility shift.** Write policies on `club_tables`, `table_types`, `pricing_rules`, `products`, `product_categories`, `equipment`, `expense_categories` and `tenant_billing_settings` moved from `app.can_manage_tenant` (owner _or_ platform) to `app.is_tenant_owner` (owner only).

> **The platform can no longer configure a club.** How a club charges is its own commercial decision. `tenant_memberships` deliberately keeps `can_manage_tenant`, because the platform must still be able to attach owners.

### `0016_platform_administration`

Owner-first reads (`platform_overview`, `platform_owners`, `platform_owner_clubs`, `platform_clubs`) and write RPCs (`platform_create_club`, `platform_assign_owner`, `platform_set_owner_active`), plus `platform_update_tenant` rebuilt with address fields and an explicit `p_clear_logo` flag — because the function coalesces its arguments, so `NULL` means "leave alone" and clearing needs its own signal.

`platform_create_club` does everything in one transaction: create the tenant → trigger provisions defaults → upsert the OWNER membership → write the audit entry. **There is no state in which a club exists but has no owner.** An email with no account raises `P0002` with a hint rather than producing an ownerless club.

### `0017_club_operations`

- `app.get_user_tenant_id()` deprecated: it now returns `NULL` when the question is ambiguous rather than silently picking one of an owner's clubs.
- `public.log_activity(...)` — the single way into the audit trail.
- `public.tenant_activity(...)`, `public.tenant_staff(...)` — owner-facing reads.
- `public.set_membership_status(...)` — revoke or restore access.
- `add_tenant_member` rebuilt: refuses `OWNER` unless the caller is the platform, and translates the receptionist-uniqueness constraint into a sentence an owner can act on.

### `0018_platform_read_scope`

The `platform_*` reads now also require `app.is_platform_admin()`.

This was found by end-to-end testing, not by reasoning: a receptionist calling `platform_owners()` got back exactly one row — the owner of their own club, whose email they could already read from `tenant_staff`. Not a leak, but a _partial_ answer from a function named `platform_owners` is a bad answer. It invites a caller to believe they are looking at the platform when they are looking at their own club.

---

## 3. Two non-obvious bugs found and fixed

**`RETURNING` re-applies the SELECT policy.** The first version of `log_activity` used `insert … returning *`. It failed for every receptionist — `activity_logs` is readable only by a club's owner, and `RETURNING` re-checks the read policy. The function now returns `void`. **The trail is deliberately write-only for the people being audited.**

**`.single()` on a single-composite RPC collapses the type to `never`.** `platform_create_club`, `platform_update_tenant`, `add_tenant_member` and the rest already return one row, so supabase-js's `.single()` narrowed a non-existent array and produced `PostgrestSingleResponse<never>`. That silently typechecked everywhere, because `never` is assignable to anything — the existing `tenants.api.ts` had the same latent bug. Removed from all eight call sites. _Verified over HTTP that the previous form did still work at runtime; this was a types bug, not a live one._

**`closeSession` reset frames to zero.** Third bug, in the session workflow — see §7.

---

## 4. The active club — state, selection, switching

Three inputs, kept deliberately separate:

| Input        | Kind         | Answers                                      |
| ------------ | ------------ | -------------------------------------------- |
| auth session | client state | who is signed in                             |
| identity     | server state | which clubs they may reach — keyed by _user_ |
| active club  | client state | which of those they are operating            |

Keying identity by user rather than by club is what makes switching cheap: changing club refetches that club's data, never the membership set.

`AppSessionState` gained a ninth variant, `club-selection`. `resolveActiveClub(clubs, storedTenantId)` is pure, so all five branches are testable without a store or a network:

| Situation                     | Result                       |
| ----------------------------- | ---------------------------- |
| no clubs                      | `null` → `no-tenant`         |
| stored club still reachable   | that club                    |
| stored club gone or suspended | fall through, and clear it   |
| exactly one reachable club    | that club, no selector shown |
| several reachable clubs       | `null` → `club-selection`    |

`useActiveClubStore` is documented emphatically as **not a security boundary**. It decides what the app shows, never what the database allows. Anyone can put any uuid in it; RLS is what makes that useless.

---

## 5. Query cache isolation

Two mechanisms, both tested.

**Structure.** Every club-scoped key starts `['tenant', tenantId, …]`, so two clubs' data physically cannot share an entry. Platform data lives under `['platform', …]` and survives a club switch.

**Eviction.** `useSwitchClub` is the only place a switch happens, and the order matters:

1. **Remove** the outgoing club's entries — not invalidate.
2. Record and persist the new choice.
3. Invalidate the incoming club, which may be stale from earlier in the session.

> Step 1 uses `removeQueries`, not `invalidateQueries`, because an invalidated entry is **still served while it refetches** — which is exactly the "club A's takings under club B's name and colours" flash worth preventing. That is the failure mode that would quietly destroy trust in the app: nobody reports it as a bug, they just stop believing the numbers.

---

## 6. Screens built

**Platform (`(platform)/`)** — dashboard with owner/club/staff counts and an ownerless-club warning; owners directory (one row per _person_, with a club count); owner detail listing every club they run, with account disable/enable; club list with owner attached and search; create-club form; branding editor with live palette preview, status control and owner assignment (replace vs. add alongside).

**Owner (`(tenant)/`)** — table management (add, edit, retire, reinstate — never hard delete); staff roster with access revoke/restore; billing rules form covering time mode, rounding, grace, overtime, frames and alert toggles; activity trail grouped by day; expenses screen with period filter, category totals and correction.

**Everyone** — club selection screen; `ActiveClubBar` above the tabs; club switcher in the header and in **More**.

`ActiveClubBar` lives in the shell, not on each screen, **so no screen can be built that forgets to say which club its numbers belong to.**

---

## 7. Session workflow — frames and quantity

`frames_played` already existed on `sessions` and the billing engine already priced it. Two things were missing.

**A real bug:** `closeSession` wrote `frames_played: 0`. The engine had already priced those frames into `table_charge_minor`, so closing a session left a row whose charge nothing on it explained. It now persists what was recorded.

**Frames input:** a stepper in `SessionSheet`, shown when the club bills frames _or_ the table's snapshotted rule is `PER_FRAME`. The count is written straight to the session, so the bill above it recomputes from the same number the close will persist — there is no separate "preview" value that could disagree with what is charged.

**Item quantity:** the item rows gained a `QuantityStepper`. Stepping below one **removes** the line rather than writing zero — `session_items` has a CHECK requiring a positive quantity, and "none of that" and "a zero-priced one of that" are not the same thing.

The rule the whole design protects is intact: **`actual_duration_seconds` is a generated column and nothing in this change can reach it.** Verified by `03_business_rules.test.sql`, which still passes.

---

## 8. Audit logging

`features/activity` is the centralised abstraction. `recordActivity()` never throws — audit logging accompanies an action that has already succeeded, and the right outcome for a failure is a missing line and a warning, not an error thrown at a receptionist who has already taken the customer's money.

`useRecordActivity(tenantId)` binds the club at the hook, so a caller cannot forget to say which club an action belonged to, or name the wrong one after a switch.

Three things are **not** parameters — the actor, their role, and the timestamp. `log_activity` fills all three from the database session. A client cannot attribute an action to somebody else or backdate it.

Wired into table management, staff changes and billing-settings updates. Several server RPCs write their own entries directly.

---

## 9. Notifications

`ClubNotification` now carries `clubName` and `tenantId` on every variant, and the club name is rendered into the **title**, not the body — a push banner truncates the body long before the title, and on a phone belonging to someone who runs four clubs the club is the first thing that has to be legible.

The in-app inbox is scoped to the active club and never merged: two clubs' alerts in one list is a list you cannot act on, because "Table 3's time is up" needs somebody standing in the right building.

One correction recorded in `push.api.ts` for whoever builds the delivery worker: `device_push_tokens.tenant_id` is a hint, not a routing key. Filtering devices by it would silently stop delivering every club an owner is not currently looking at. The worker must resolve recipients from the notification's tenant through `tenant_memberships`, then find their devices by `user_id`.

---

## 10. Cash and expenses

Added a **previous days** section to the Cash screen from `useRecentClosings`, showing the counted amount and whether it balanced. Closings are never edited — a wrong count is corrected by a note, not by rewriting the number — so it is a record, not a form.

New **Expenses** screen: period filter (today / 7 days / 30 days / all), totals split by "out" and "from the drawer", a per-category breakdown, and correction of an existing expense.

`useUpdateExpense` invalidates **both** dates. Moving an expense from Tuesday to Wednesday changes what both days' tills should hold, and refreshing only the destination would leave Tuesday quietly overstated.

Ranges are computed from the club's **business** date, not the device's calendar date — a club whose trading day ends at 02:00 is still on yesterday's books at 01:00.

---

## 11. Security verification — evidence, not assertion

Every RPC was exercised as the `authenticated` Postgres role and over real HTTP with real GoTrue tokens.

| Property                                             | Result                           |
| ---------------------------------------------------- | -------------------------------- |
| Owner holds two active memberships                   | ✅ 2 rows, different colours     |
| Second **active** receptionist membership            | ✅ refused, `23505`              |
| Multi-club owner reads Blue Cue tables               | ✅ 0 rows                        |
| Receptionist adds a table                            | ✅ `403`                         |
| Owner updates their second club's billing settings   | ✅ `200`                         |
| **Platform admin** updates a club's billing settings | ✅ **0 rows changed**            |
| Owner grants `OWNER`                                 | ✅ `403`                         |
| Owner calls `platform_create_club`                   | ✅ `403`                         |
| Owner calls `platform_overview`                      | ✅ `[]` with `200`               |
| Receptionist appends to own club's trail             | ✅ `204`                         |
| Receptionist appends to another club's trail         | ✅ `403`                         |
| Receptionist reads the trail                         | ✅ 0 entries                     |
| Owner revokes their own access                       | ✅ refused, `42501`              |
| Last active owner removed from a club                | ✅ refused, `23514`              |
| Suspending one club                                  | ✅ owner's other clubs untouched |
| Disabling an owner's account                         | ✅ every club revoked at once    |

Also held throughout: no service-role key reaches mobile; no policy anywhere reads a tenant id supplied by the client; `public.tenants` remains unwritable by any client role.

---

## 12. Testing

| Suite                  | Before | After   |
| ---------------------- | ------ | ------- |
| pgTAP (`pnpm db:test`) | 119    | **212** |
| Jest (`pnpm test`)     | 181    | **194** |

**`04_multi_club.test.sql`** (38 assertions) covers the eleven named cases: multi-club membership; the receptionist constraint; reading all owned clubs; reading none of an unowned one; receptionist scope; cross-club writes matching nothing; owner-only configuration; platform-cannot-configure; platform-only ownership grants; per-club suspension; owner-account disable; books staying with the club that earned them.

**`05_platform_administration.test.sql`** (27 assertions) covers platform-only reads, club creation and provisioning, staffing guards and the audit trail.

**Jest additions:** `resolveActiveClub` (all five branches), club switching and cache isolation (including that platform data survives a switch), and the active-club store including storage failure.

Two pre-existing pgTAP assertions were **updated, not deleted** — `01` asserted the Royal owner sees exactly one tenant, and `02` that an unfiltered billing update touches one row. Both are now false _because the model changed_, and both were rewritten to assert the new correct behaviour, with a second assertion added showing the update can still be scoped to one club.

---

## 13. Validation — every command, actually run

| Step                    | Command                          | Result                                  |
| ----------------------- | -------------------------------- | --------------------------------------- |
| Database rebuild + seed | `supabase db reset --local`      | ✅ 18 migrations applied, seeded        |
| Schema lint             | `supabase db lint`               | ✅ no schema errors                     |
| Database tests          | `supabase test db`               | ✅ **212 assertions, 5 files, PASS**    |
| Generated types in sync | `supabase gen types` + diff      | ✅ regenerated and committed            |
| Typecheck               | `tsc --noEmit`                   | ✅ no errors                            |
| Lint                    | `eslint src --max-warnings=0`    | ✅ no errors                            |
| Format                  | `prettier --check`               | ✅ all files                            |
| Unit tests              | `jest`                           | ✅ **194 tests, 15 suites, PASS**       |
| **Metro bundle**        | `expo export --platform android` | ✅ **4016 modules, 8.54 MB, no errors** |
| End-to-end HTTP         | curl against GoTrue + PostgREST  | ✅ see §11                              |

The Metro bundle matters here: it is the check that catches route-tree and import errors typecheck cannot see, and it exercises all eleven new screens.

Two lint findings were real and worth naming: `activity.recent()` omitted `limit` from its query key, so two screens asking for 20 and 100 entries would have shared one cache entry and shown a truncated history as if it were complete. Fixed, with `activity.all()` added as the invalidation prefix.

---

## 14. Status

### ✅ IMPLEMENTED

Multi-club ownership at the database level · owner-only club configuration · platform administration (dashboard, owners, owner detail, clubs, create, brand, assign, disable) · active-club context, persistence and re-validation · club selection screen · club switching with cache eviction · active-club header · owner table management · staff management · billing settings UI · frames input and persistence · session item quantity · centralised audit logging and the activity screen · club-aware notifications · cash closing history · expense date filtering and correction · pgTAP for all eleven multi-club cases · unit tests for resolution, switching and cache isolation · README, architecture, database, security and operations docs.

### ⚠️ PARTIALLY IMPLEMENTED

**Push delivery.** Tokens are captured, club-scoped and re-pointed on switch; notification _copy_ names its club. The server-side worker that actually sends does not exist. `docs/notifications.md` and the corrected comment in `push.api.ts` describe what it must do.

**Custom billing slabs.** `CUSTOM_SLABS` is selectable and the engine implements it, but the slab ladder itself is still edited in SQL — the settings screen has no editor for a JSON array of price bands.

**Platform club deletion.** Clubs can be created, branded, suspended and archived. There is no delete, by design — but no explicit "archive and export" flow either.

### ❌ NOT IMPLEMENTED

**Creating login accounts from inside the app.** Deliberate. Creating a Supabase Auth user requires the service-role key, which must never reach a phone. Both `platform_create_club` and `add_tenant_member` raise `P0002` with a hint rather than creating something half-made. Accounts are created in the Supabase dashboard first — see `docs/operations.md`.

**Multi-club _staff_.** Owners span clubs; receptionists do not. Relaxing this is one index, but the operational question ("whose shift is this?") should be answered first.

**Equipment screens.** Schema and RLS exist; no UI. Unchanged by this work.

**Offline sync.** Query caching handles brief drops. Real offline-first is a separate design.

---

## 15. What I would look at next

1. **The push delivery worker** is the largest remaining gap between "the product works" and "the product tells you when something needs attention". The schema, the copy and the token registration are all ready for it.
2. **A slab editor** in the billing screen, so `CUSTOM_SLABS` stops requiring SQL.
3. **Owner-level cross-club reporting** — deliberately _not_ built here, because every existing report is correctly per-club and merging them is a genuine product decision rather than a technical one. An owner running four clubs will eventually want one revenue figure; that should be designed, not inferred.
4. **A second look at `app.get_user_tenant_id()`** — it is deprecated and unused by any policy, and could simply be dropped once nothing references it.
