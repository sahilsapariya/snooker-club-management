# Database

Postgres 17 on Supabase. Every schema change is a migration in
`supabase/migrations/`; nothing is applied by hand.

---

## Migration order

| File                           | Contains                                                         |
| ------------------------------ | ---------------------------------------------------------------- |
| `0001_foundation`              | `app` schema, enums, shared immutable helpers                    |
| `0002_identity_and_tenants`    | profiles, platform_admins, tenants, tenant_memberships           |
| `0003_authorization`           | the SECURITY DEFINER helpers every policy is written in terms of |
| `0004_club_configuration`      | billing settings, table types, club tables, pricing rules        |
| `0005_catalog_and_inventory`   | product categories, products, inventory ledger, equipment        |
| `0006_operations`              | sessions, session items, expenses, cash closings                 |
| `0007_notifications_and_audit` | notifications, push tokens, activity log                         |
| `0008_views`                   | read models (`security_invoker`)                                 |
| `0009_rls_policies`            | every policy, in one reviewable file                             |
| `0010_provisioning`            | auth triggers, tenant defaults, platform RPCs                    |
| `0011_grants`                  | privilege lockdown                                               |

RLS is enabled in the table-creation migrations and the policies arrive in
`0009`. Between the two, the tables deny everything — the safe direction to fail.

---

## Money

**Integer minor units in `bigint` columns, suffixed `_minor`.**
`12550` is ₹125.50.

Why not `numeric`: PostgREST serialises `numeric` as a JSON number, so the value
crosses into JavaScript as a float anyway, and the exactness `numeric` bought in
the database is lost at the boundary. Why not floating point: it is wrong.

Integers are exact end to end. A `bigint` holds ±92 quintillion; in paise that
is far beyond any real amount, and comfortably inside JavaScript's safe integer
range for the values a club will ever see.

Each tenant carries `currency_code` and `currency_minor_units` (2 for INR/USD,
0 for JPY), and `formatMoney()` in the app splits the integer with integer
arithmetic — it never divides into a float.

Rates work the same way: `pricing_rules.rate_minor`,
`tenant_billing_settings.overtime_rate_minor`.

---

## Time

Every timestamp is `timestamptz`, therefore stored in UTC.

Business days are derived, not stored ad hoc. Each tenant has a `timezone` and a
`business_day_cutoff`; a club that trades until 4 a.m. sets `04:00`, and a
session started at 01:30 local then belongs to the previous business day.

```sql
app.business_date(p_at timestamptz, p_timezone text, p_cutoff time) returns date
```

`sessions.business_date` and `expenses.expense_date` are stamped by trigger from
the club's own clock, so the same instant lands on the right day for a club in
Kochi and for its owner reading reports from London. The app mirrors this exactly
in `src/lib/format/datetime.ts` — the two are tested against the same example.

---

## The rule the schema exists to protect

```sql
actual_duration_seconds integer generated always as (
  case when ended_at is null then null
       else greatest(0, floor(extract(epoch from (ended_at - started_at)))::integer)
  end
) stored
```

A generated column cannot be written by anybody — client, service role or
migration. Attempting it raises `428C9`. Billing rules produce
`billable_duration_seconds`, an ordinary column, and the two are free to differ.

The companion constraint keeps sessions honest about their own lifecycle:

```sql
constraint sessions_terminal_state check (
  (status in ('ACTIVE', 'TIME_COMPLETED') and ended_at is null)
  or
  (status in ('CLOSED', 'CANCELLED') and ended_at is not null)
)
```

An open session structurally has no end time. `TIME_COMPLETED` is an _open_
state: the booked time has elapsed, staff can be alerted, and the clock keeps
running until someone closes it. A partial unique index enforces one open
session per table.

---

## Historical integrity

**Prices are snapshotted at sale.** `session_items` stores
`product_name_snapshot` and `unit_price_minor` copied from the catalogue at
insert time, and a trigger raises if either is later changed. Raising a product's
price tomorrow cannot rewrite yesterday's bill.

**Stock is a ledger, not a number.** `inventory_movements` is append-only
(`UPDATE`/`DELETE` revoked at the grant level). `products.stock_quantity` is a
cached projection maintained by trigger. Selling a product posts a `SALE`
movement; removing the line posts a compensating `CORRECTION` rather than
editing the original.

**The audit log is append-only** for the same reason and by the same mechanism.

Derived totals are generated columns, so they cannot drift:

```sql
total_amount_minor  = table_charge_minor + items_total_minor - discount_minor
expected_cash_minor = opening_cash_minor + cash_received_minor - cash_expenses_minor
line_total_minor    = round(unit_price_minor * quantity)
```

---

## Cross-tenant referential integrity

Child rows carry `tenant_id` and reference their parent by composite key:

```sql
-- parent
constraint club_tables_tenant_id_key unique (tenant_id, id)

-- child
constraint sessions_table_same_tenant
  foreign key (tenant_id, table_id)
  references public.club_tables (tenant_id, id)
```

A session cannot point at another club's table. Not "is prevented from" — cannot.
This holds independently of RLS, and independently of which role is writing.

`ON DELETE NO ACTION` (checked at end of statement) rather than `RESTRICT`
(checked immediately) so that deleting a tenant still cascades through the whole
graph in one statement.

---

## Extensibility choices

**Table types are rows, not an enum.** `POOL_SMALL`, `POOL_REGULAR` and
`SNOOKER` are seeded per tenant. A club that adds English Billiards or Carrom
needs a row, not a migration.

**Categories are rows.** Both expense and product categories are tenant-scoped
tables with seeded defaults.

**Pricing and billing rules are data.** Nothing about time calculation,
rounding, grace periods, overtime or frame pricing is hard-coded anywhere in the
app; it is all in `pricing_rules` and `tenant_billing_settings`, and the two
seeded clubs are configured differently on purpose to prove it.

**`activity_logs.action` is free text.** New operational events should never
require a type migration.

Enums are used where the domain is genuinely closed (`session_status`,
`payment_status`, `equipment_status`) and can still be extended with
`ALTER TYPE … ADD VALUE`.

---

## Table reference

| Table                     | Notes                                                     |
| ------------------------- | --------------------------------------------------------- |
| `profiles`                | mirrors `auth.users`; created by trigger                  |
| `platform_admins`         | platform authority as revocable rows                      |
| `tenants`                 | one club; every column platform-controlled                |
| `tenant_memberships`      | user ↔ club ↔ role; one active membership per user today  |
| `tenant_billing_settings` | 1:1 with tenant; all billing rules                        |
| `table_types`             | extensible catalogue per club                             |
| `club_tables`             | physical tables; occupancy derived, not stored            |
| `pricing_rules`           | per club / type / table, with validity windows            |
| `sessions`                | recorded facts + billing outputs, kept separate           |
| `session_items`           | consumables with price snapshots                          |
| `product_categories`      | tenant-scoped                                             |
| `products`                | catalogue + cached stock                                  |
| `inventory_movements`     | append-only stock ledger                                  |
| `equipment`               | club assets tracked by status                             |
| `expense_categories`      | tenant-scoped, seeded defaults flagged `is_system`        |
| `expenses`                | attributed to a business date                             |
| `cash_closings`           | one per club per business date; arithmetic generated      |
| `notifications`           | tenant inbox; null recipient = broadcast                  |
| `device_push_tokens`      | Expo tokens only; no push credentials anywhere in the app |
| `activity_logs`           | append-only audit trail                                   |

Two read models, both `security_invoker = true` so RLS still applies:

- `v_club_table_overview` — tables plus their current occupancy
- `v_low_stock_products` — products at or below their threshold

---

## Changing the schema

```bash
# edit or add a file in supabase/migrations/
pnpm db:reset      # rebuild from scratch and re-seed
pnpm db:lint       # static analysis
pnpm db:test       # pgTAP suite
pnpm db:types      # regenerate the client types
```

Never modify a migration that has been applied to a hosted project — add a new
one. `pnpm db:diff -- some_name` will draft a migration from local drift if you
experimented in Studio first.
