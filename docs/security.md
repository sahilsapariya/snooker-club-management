# Security

The mobile app is treated as hostile. It runs on a device we do not control,
ships with a key anyone can extract, and can be modified. Nothing it says about
who the user is, which club they belong to or what role they hold is trusted.

Every guarantee below is enforced by Postgres and verified by `pnpm db:test`.

---

## Four layers

### 1. Row Level Security

Enabled on all 19 tables. Policies are expressed in terms of helpers that live
in the `app` schema, which is **not** in PostgREST's exposed schema list — no
client can call them with a forged argument to probe the system.

```sql
app.is_platform_admin()               -- active row in platform_admins
app.tenant_ids()                      -- clubs the caller actively belongs to
app.get_user_tenant_id()
app.is_tenant_member(tenant_id)
app.has_tenant_role(tenant_id, roles…)
app.can_read_tenant(tenant_id)        -- member, or platform operator
app.can_operate_tenant(tenant_id)     -- OWNER or RECEPTIONIST
app.can_manage_tenant(tenant_id)      -- OWNER, or platform operator
app.is_tenant_owner(tenant_id)        -- OWNER only, no platform escalation
```

Each is `SECURITY DEFINER`, `STABLE`, and `SET search_path = ''`:

- **`SECURITY DEFINER`** — they read `platform_admins` and `tenant_memberships`,
  which are themselves RLS-protected. Without it, a policy consulting membership
  would recurse into the table it is protecting.
- **`STABLE`** — one evaluation per statement, hoisted into an InitPlan rather
  than re-run per row.
- **`search_path = ''`** — every name inside is fully qualified, so a hostile
  `search_path` cannot shadow a table or an operator inside a definer function.

`app.tenant_ids()` also filters on tenant status and profile activity, so
suspending a club or disabling an account revokes data access immediately,
without touching a single membership row.

### 2. Composite foreign keys

```sql
constraint sessions_table_same_tenant
  foreign key (tenant_id, table_id) references public.club_tables (tenant_id, id)
```

Applied throughout: tables → types, sessions → tables and pricing rules, session
items → sessions and products, products → categories, expenses → categories,
movements → products, equipment → tables.

This makes a cross-tenant row reference structurally impossible. It holds even
if an RLS policy is written incorrectly, and even for a service-role writer.

### 3. Grants

```sql
revoke all on all tables in schema public from anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
revoke update, delete on public.inventory_movements from authenticated;
revoke update, delete on public.activity_logs       from authenticated;
revoke insert, update, delete on public.tenants     from authenticated;
```

The opening `revoke` is not ceremonial. **Supabase's stock default privileges
grant `ALL` on new tables in `public` to `anon` and `authenticated`, and `ALL`
includes `TRUNCATE` — which ignores Row Level Security completely.** A signed-in
receptionist holding `TRUNCATE` on `public.sessions` could erase every club's
history in one statement with RLS fully enabled. `ALL` also includes `TRIGGER`
and `REFERENCES`, which no client needs.

`ALTER DEFAULT PRIVILEGES` is reset the same way, so a table added by a future
migration cannot silently reintroduce it.

`anon` ends up with nothing at all. Nothing in this product is public.

### 4. `public.tenants` is not writable by any client role

Club name, logo, colours, currency, timezone and status are platform-controlled.
There is no `INSERT`/`UPDATE`/`DELETE` policy on `tenants` for anyone, and the
privilege is revoked from `authenticated` as well — which includes the platform
super admin, who is an authenticated user like everybody else.

Platform mutations go through SECURITY DEFINER RPCs that re-check authority
inside the database:

```sql
public.platform_create_tenant(…)
public.platform_update_tenant(…)
public.platform_set_tenant_status(…)
```

This is the difference between "the UI does not offer it" and "the privilege
does not exist on the role". No future policy mistake can hand club staff a way
to rewrite their own branding.

---

## Column-level guards

Two triggers cover cases where row-level access is correct but a specific column
must not move:

- **`app.profiles_guard`** — a user may edit their own name, phone and avatar,
  but not `is_active` or `email`. Without it, a disabled user could flip their
  own `is_active` back to `true` and walk straight back in.
- **`app.notifications_guard`** — a recipient may set `read_at` and nothing else,
  so the "mark as read" policy cannot be used to rewrite the message.

Both exempt callers with no end-user identity (`auth.uid() is null`), which is
how the service role, migrations and the Supabase dashboard operate. That is not
a bypass: `anon` has no privilege on those tables at all, and an `authenticated`
request always carries a `sub` claim.

---

## What the app is trusted with

Nothing that matters.

- **Route guards are UX.** `src/app/index.tsx` decides which shell to render.
  A club user who somehow reached `/(platform)/tenants` would see an empty list
  and every write would be refused.
- **Hidden buttons are not authorization.** `canManageClub()` exists so a
  receptionist is not shown a control that would fail; the database is what makes
  it fail.
- **`.eq('tenant_id', …)` in a query is an optimisation.** Removing it would not
  change what comes back.

---

## The anon key

`EXPO_PUBLIC_SUPABASE_ANON_KEY` is compiled into the bundle and readable by
anyone with the APK. That is by design. It identifies the project; it grants no
authority. `anon` holds zero privileges on every table in this schema, so an
extracted key without a valid user session opens nothing.

The **service role key** is the opposite: it bypasses RLS entirely. It must
never appear in `apps/mobile/`, in any `EXPO_PUBLIC_*` variable, in
`app.config.ts`, or in any file that reaches a device. It belongs to trusted
server-side processes only.

Also never in the app: the database password, Expo push access tokens, FCM
server keys, APNs keys.

---

## What the tests actually prove

`pnpm db:test` — 119 assertions, run as the `authenticated` Postgres role.
Running them as `postgres` would prove nothing: that role has `BYPASSRLS`.

**`01_tenant_isolation.test.sql`**

- A Royal Snooker user sees exactly one tenant and zero Blue Cue rows across
  tables, products, pricing, expenses, equipment, memberships, stock and billing
- The read models leak nothing either — views are `security_invoker`
- Cross-tenant `UPDATE`/`DELETE` match zero rows, and the target rows are
  verified unchanged afterwards
- Cross-tenant `INSERT` is refused with `42501`
- `anon` cannot read tenants, tables or sessions at all
- The platform operator does see every club

**`02_role_authorization.test.sql`**

- A receptionist can start sessions and record expenses, but cannot add tables,
  change pricing, change products, change billing rules or read the audit trail
- A receptionist cannot promote themselves, cannot insert into `platform_admins`,
  and cannot use `add_tenant_member` to promote anyone
- Neither a receptionist **nor an owner** can change branding or tenant status
- Not even the platform admin can `UPDATE public.tenants` directly; the RPC path
  works and the change is verified to have landed
- An owner cannot add staff to another club
- The stock ledger and audit log reject `UPDATE`/`DELETE`
- A disabled account loses all data access and cannot re-enable itself
- A suspended club exposes no operational data, but its own row stays readable so
  the app can render a "suspended" screen
- `table_privs_are` pins the exact privilege set: no `TRUNCATE`, no `TRIGGER`,
  no `REFERENCES`; `anon` has none; and an owner's `TRUNCATE` attempt is refused

**`03_business_rules.test.sql`**

- A 67-minute session against a 60-minute booking records 4020 s actual and
  3600 s billable, and `actual_duration_seconds` cannot be written (`428C9`)
- The recorded start time is immutable
- An open session cannot carry an end time; a closed one must
- Reaching the booked time does not end the session
- A busy table refuses a second open session
- A price rise does not rewrite an existing bill; the snapshot is immutable
- Selling moves stock through the ledger, and removing a line appends a
  correction rather than editing history
- Cross-tenant references are refused with `23503` even with RLS bypassed
- Business dates honour the club's own trading-day cutoff

---

## Checklist before a hosted deployment

- [ ] `enable_signup = false` in `supabase/config.toml` matches the dashboard
- [ ] Every migration applied: `pnpm db:push`
- [ ] `pnpm verify:db` passes against the target
- [ ] Supabase advisors show no "RLS disabled" or "SECURITY DEFINER view" findings
- [ ] The service role key is only in your CI secret store
- [ ] `apps/mobile/.env` contains only the two `EXPO_PUBLIC_*` values
- [ ] The first platform super admin is created and verified
- [ ] Auth rate limits and password policy reviewed in the dashboard
- [ ] Point-in-time recovery / backups enabled

---

## Reporting

This is a private operational product. Security issues should go to the product
owner directly rather than into a public tracker.
