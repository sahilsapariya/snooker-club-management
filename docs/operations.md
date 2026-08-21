# Operations

Day-to-day running of the platform: provisioning clubs and staff, suspension,
and getting schema changes onto a hosted project.

---

## Local development

```bash
nvm use && pnpm install
pnpm supabase:start      # Postgres, Auth, PostgREST, Studio (Docker)
pnpm db:reset            # every migration + seed
pnpm dev
```

`pnpm supabase:status` prints the local URLs and keys. Studio is at
<http://127.0.0.1:54323>; the local mail catcher (for password resets) is at
<http://127.0.0.1:54324>.

Seeded accounts, password `DevPassword123`:

| Email                        | Role                        |
| ---------------------------- | --------------------------- |
| `admin@snookerplatform.dev`  | platform super admin        |
| `owner@royalsnooker.dev`     | owner, Royal Snooker Club   |
| `reception@royalsnooker.dev` | receptionist, Royal Snooker |
| `owner@bluecue.dev`          | owner, Blue Cue Club        |
| `reception@bluecue.dev`      | receptionist, Blue Cue      |

`supabase/seed.sql` writes to `auth.users` directly. That is safe for a
throwaway local stack and **must never be run against a hosted project** — the
passwords are fixtures, not credentials.

---

## Connecting to a hosted project

```bash
pnpm supabase login
pnpm supabase link --project-ref <ref>
pnpm db:push                        # apply every migration
pnpm db:types:remote                # regenerate client types
```

Then point the app at it in `apps/mobile/.env`:

```
EXPO_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<the publishable / anon key>
```

The service role key is **not** part of this and must never go in that file.

If the app reports that `public.tenants` does not exist, the migrations have not
been pushed to the project the `.env` points at.

Mirror the auth settings from `supabase/config.toml` in the dashboard —
particularly **disable self-signup**, and set the redirect URLs to
`snookerclub://` plus your Expo development URL.

---

## Creating the first platform super admin

Only a `SUPER_ADMIN` can grant platform authority, so the first one is created
out of band.

1. Dashboard → Authentication → Users → **Add user**. Real address, strong
   password, email confirmed.
2. SQL editor:

   ```sql
   insert into public.platform_admins (user_id, role, notes)
   select id, 'SUPER_ADMIN', 'Product owner'
   from auth.users
   where email = 'you@yourdomain.com'
   on conflict (user_id) do update set is_active = true;
   ```

3. Verify:

   ```sql
   select p.email, pa.role, pa.is_active
   from public.platform_admins pa
   join public.profiles p on p.id = pa.user_id;
   ```

Platform authority is a row. Revoking it is
`update public.platform_admins set is_active = false where user_id = …`.

A `SUPPORT` platform role also exists: it can read across clubs but cannot grant
or revoke platform authority.

---

## Onboarding a club

The order matters: **the owner's account exists first, then the club is created
under it.** There is no intermediate state in which a club exists with nobody
able to configure it.

**1. Create the owner's account.** Dashboard → Authentication → Users. There is
no self-signup, and the app cannot do this — creating an auth user needs the
service-role key, which never reaches a phone.

Skip this step if the person already owns a club with you. **One owner can run
any number of clubs from the same login**, and that is the normal case for a
customer opening a second venue.

**2. Create the club under them.** In the app: **Platform → Create a club**. Or
from SQL, as a signed-in platform admin:

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

One transaction: creates the tenant, provisions it (billing settings, the three
default table types, default expense and product categories), attaches the owner
and writes the audit entry. If the email has no account it raises `P0002` with a
hint and creates nothing.

**3. Hand over.** The owner adds their own receptionists from **More → Staff**,
and configures their own tables, pricing, products and billing rules. You do not
need to be involved, and in most cases you _cannot_ be: since migration `0015`
club configuration requires `app.is_tenant_owner(tenant_id)`, which a platform
admin is not.

If you do need to add someone yourself:

```sql
select public.add_tenant_member('<tenant-uuid>', 'reception@theirclub.com', 'RECEPTIONIST');
```

Note that only you can grant `OWNER` — an owner cannot promote anyone to owner
of their own club.

**4. Adjust branding** at any time, from **Platform → the club → Branding**, or:

```sql
select public.platform_update_tenant(
  '<tenant-uuid>',
  p_primary_color => '#9f1239',
  p_theme_preset  => 'burgundy',
  p_logo_url      => 'https://cdn.example.com/logo.png'
);
-- removing a logo needs its own flag: NULL means "leave unchanged"
select public.platform_update_tenant('<tenant-uuid>', p_clear_logo => true);
```

**5. Go live:**

```sql
select public.platform_set_tenant_status('<tenant-uuid>', 'ACTIVE');
```

### Adding a second club for an existing owner

Exactly step 2 again with a different name and slug. Their next sign-in shows a
club selector instead of going straight to the floor; the switcher lives in the
header and in **More → Switch club**. Nothing is shared between the clubs —
separate tables, staff, prices, books, alerts and colours.

### Moving a club to a new owner

```sql
-- the club was sold: the previous owner loses access immediately
select public.platform_assign_owner('<tenant-uuid>', 'new@owner.com', true);

-- a partnership: both keep access
select public.platform_assign_owner('<tenant-uuid>', 'second@owner.com', false);
```

`replace_existing` is explicit rather than inferred because the two cases are
genuinely different commercial events, and guessing would be wrong half the
time.

---

## Suspension and offboarding

```sql
select public.platform_set_tenant_status('<tenant-uuid>', 'SUSPENDED');
```

Takes effect immediately: `app.tenant_ids()` filters on tenant status, so every
member loses access to operational data on their next request. Their own tenant
row stays readable so the app can render a clear "this club is suspended"
screen rather than a confusing empty one.

`ARCHIVED` behaves the same way and signals a permanent end.

Suspending one club of a multi-club owner affects **only that club**. Their
other clubs keep operating and stay in their switcher; the suspended one
disappears from it, and if it was the club they had open they are returned to
the selector.

### Ending one person's access

Two different levers, for two different situations.

**One club only** — a receptionist leaving, or an owner selling one venue. From
the app: **More → Staff → the person → Remove access**. Or:

```sql
select public.set_membership_status('<membership-uuid>', 'DISABLED');
```

Never delete the membership. A former receptionist's name still appears against
every session they opened and every payment they took; removing the row would
orphan that history. `DISABLED` stops appearing in `app.tenant_ids()`, which is
what actually ends access.

Two guards are enforced in the function, not the UI: a club cannot be left
without an active owner, and nobody can revoke their own access.

**Every club at once** — an owner relationship ending. From the app:
**Platform → Owners → the person → Disable this account**. Or:

```sql
select public.platform_set_owner_active('<user-uuid>', false);
```

This sets `profiles.is_active = false`, which `app.tenant_ids()` also checks, so
they lose every club simultaneously. Their clubs keep operating — the
receptionists are unaffected.

A disabled account cannot re-enable itself — `app.profiles_guard` blocks it.

---

## Schema changes

```bash
# 1. add a file to supabase/migrations/  (timestamp_description.sql)
pnpm db:reset          # rebuild locally from scratch
pnpm db:lint           # static analysis
pnpm db:test           # pgTAP: RLS, roles, business rules
pnpm db:types          # regenerate client types
pnpm verify            # format, lint, typecheck, unit tests
# 2. commit migration + regenerated types together
pnpm db:push           # apply to the linked hosted project
```

Never edit a migration that has already been applied to a hosted project — add a
new one. If you experimented in Studio, `pnpm db:diff -- some_name` will draft
the migration for you.

New tables need three things or they are a hole: `alter table … enable row level
security`, policies in the RLS migration, and grants that do not reinstate
`TRUNCATE`. The `ALTER DEFAULT PRIVILEGES` in migration `0011` handles the last
one automatically, and `pnpm db:test` will catch the first two.

---

## Reference

| Function                                    | Who                | Effect                                |
| ------------------------------------------- | ------------------ | ------------------------------------- |
| `platform_create_tenant(name, slug, …)`     | platform admin     | creates a club, seeds its defaults    |
| `platform_update_tenant(id, …)`             | platform admin     | branding, locale, contact             |
| `platform_set_tenant_status(id, status)`    | platform admin     | trial / active / suspended / archived |
| `add_tenant_member(tenant_id, email, role)` | owner or platform  | links an existing account to a club   |
| `is_platform_admin()`                       | any signed-in user | advisory; RLS is the enforcement      |
| `get_user_tenant_id()`                      | any signed-in user | advisory                              |

Useful checks:

```sql
-- who is at which club
select t.name, p.email, m.role, m.status
from public.tenant_memberships m
join public.tenants t on t.id = m.tenant_id
join public.profiles p on p.id = m.user_id
order by t.name, m.role;

-- any table missing RLS  (should return nothing)
select c.relname
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;

-- what the client roles can actually do  (anon should return nothing)
select table_name, privilege_type
from information_schema.role_table_grants
where grantee = 'anon' and table_schema = 'public';
```
