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

**1. Create the tenant.** As a signed-in platform admin:

```sql
select public.platform_create_tenant(
  p_name          => 'Royal Snooker Club',
  p_slug          => 'royal-snooker',
  p_primary_color => '#059669',
  p_currency_code => 'INR',
  p_timezone      => 'Asia/Kolkata',
  p_status        => 'TRIAL'
);
```

A trigger provisions it with billing settings, the three default table types and
the default expense and product categories. Returns the new row, including its
`id`.

**2. Create their accounts.** Dashboard → Authentication → Users, one per person.
There is no self-signup.

**3. Link them to the club:**

```sql
select public.add_tenant_member('<tenant-uuid>', 'owner@theirclub.com', 'OWNER');
select public.add_tenant_member('<tenant-uuid>', 'reception@theirclub.com', 'RECEPTIONIST');
```

`add_tenant_member` is also callable by the club's own owner, so they can add
receptionists themselves.

**4. Set branding:**

```sql
select public.platform_update_tenant(
  '<tenant-uuid>',
  p_primary_color => '#9f1239',
  p_theme_preset  => 'burgundy',
  p_logo_url      => 'https://cdn.example.com/logo.png'
);
```

**5. Hand over.** The owner configures their own tables, pricing, products and
billing rules from inside the app.

**6. Go live:**

```sql
select public.platform_set_tenant_status('<tenant-uuid>', 'ACTIVE');
```

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

Disabling one person instead:

```sql
update public.profiles set is_active = false where email = 'someone@club.com';
-- or remove the membership entirely
update public.tenant_memberships set status = 'DISABLED'
where user_id = (select id from public.profiles where email = 'someone@club.com');
```

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
