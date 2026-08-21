# Database

Postgres 17 on Supabase. Every schema change is a migration in
`supabase/migrations/`; nothing is applied by hand.

---

## Migration order

| File                            | Contains                                                         |
| ------------------------------- | ---------------------------------------------------------------- |
| `0001_foundation`               | `app` schema, enums, shared immutable helpers                    |
| `0002_identity_and_tenants`     | profiles, platform_admins, tenants, tenant_memberships           |
| `0003_authorization`            | the SECURITY DEFINER helpers every policy is written in terms of |
| `0004_club_configuration`       | billing settings, table types, club tables, pricing rules        |
| `0005_catalog_and_inventory`    | product categories, products, inventory ledger, equipment        |
| `0006_operations`               | sessions, session items, expenses, cash closings                 |
| `0007_notifications_and_audit`  | notifications, push tokens, activity log                         |
| `0008_views`                    | read models (`security_invoker`)                                 |
| `0009_rls_policies`             | every policy, in one reviewable file                             |
| `0010_provisioning`             | auth triggers, tenant defaults, platform RPCs                    |
| `0011_grants`                   | privilege lockdown                                               |
| `0012_session_business_date`    | the trading day is derived by the server, never supplied         |
| `0013_daily_cash_summary`       | the till's expected-vs-counted read model                        |
| `0014_reports`                  | revenue, table, product and expense aggregates                   |
| `0015_multi_club_ownership`     | one owner, many clubs; club config moves to the owner alone      |
| `0016_platform_administration`  | owner directory, club creation, ownership assignment             |
| `0017_club_operations`          | staff roster, membership status guards, the audit-trail helper   |
| `0018_platform_read_scope`      | the `platform_*` reads answer only to the platform               |
| `0019_notification_events`      | triggers that raise every alert, with the right audience         |
| `0020_push_queue`               | the delivery queue and its service-role-only readers             |
| `0021_scheduled_events`         | the time-up sweep and the unreconciled-till reminder             |
| `0022_session_payments`         | payments become rows; the session's totals follow them           |
| `0023_money_follows_the_ledger` | the till counts by the day money arrived, not the day of trade   |
| `0024_close_session`            | closing and its first payment, in one transaction                |
| `0025_equipment_operations`     | staff report condition; the owner configures and retires         |

RLS is enabled in the table-creation migrations and the policies arrive in
`0009`. Between the two, the tables deny everything — the safe direction to fail.

### What `0015` actually changed

Almost nothing, and that is the point. `tenant_memberships` was always
many-to-many and `app.tenant_ids()` always returned a set, so exactly one object
stood between the schema and multi-club ownership:

```sql
-- before: nobody could hold two active memberships
drop index tenant_memberships_single_active_per_user;

-- after: the constraint applies to staff, not to owners
create unique index tenant_memberships_single_active_club_for_staff
  on public.tenant_memberships (user_id)
  where status = 'ACTIVE' and role = 'RECEPTIONIST';
```

The second half of `0015` is a responsibility shift rather than a capability
one: the write policies on `club_tables`, `table_types`, `pricing_rules`,
`products`, `product_categories`, `equipment`, `expense_categories` and
`tenant_billing_settings` moved from `app.can_manage_tenant` (owner _or_
platform) to `app.is_tenant_owner` (owner only). Configuring a club is the
club's business, not the platform's. `tenant_memberships` deliberately keeps
`can_manage_tenant`, because the platform must be able to attach owners.

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
require a type migration. Everything writes through `public.log_activity`, which
is `SECURITY INVOKER` — so RLS decides whether the write is allowed, and the
actor and their role are resolved from the session rather than accepted as
arguments. It returns `void` on purpose: `activity_logs` is readable only by a
club's owner, and `RETURNING` re-applies the `SELECT` policy, so echoing the row
back would make the function fail for exactly the receptionists who generate
most of the entries. The trail is deliberately write-only for the people being
audited.

**Ownership is a membership, not a table.** There is no `owners` table. An owner
is a `tenant_memberships` row with `role = 'OWNER'`, which is why an owner
running four clubs needs no special case anywhere — they hold four rows.

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

## Reporting functions

Aggregates live in SQL rather than the client, because summing a quarter's
sessions on a phone means shipping a quarter's sessions to it.

| Function                                     | Returns                                                        |
| -------------------------------------------- | -------------------------------------------------------------- |
| `daily_cash_summary(tenant, date)`           | takings and spend for one trading day, split by payment method |
| `report_revenue_summary(tenant, from, to)`   | headline figures, including played vs billed seconds           |
| `report_daily_revenue(tenant, from, to)`     | one row per day, zero-filled so gaps stay visible              |
| `report_table_performance(tenant, from, to)` | sessions, takings and time played per table                    |
| `report_product_sales(tenant, from, to)`     | quantity and revenue, from the sale-time snapshots             |
| `report_expense_breakdown(tenant, from, to)` | spend per category                                             |

Plus `v_outstanding_sessions`, a view of closed sessions with money still owed.

**Every one of them is `SECURITY INVOKER`.** They take a `tenant_id` argument,
but that argument is not the security boundary - RLS is. A `SECURITY DEFINER`
function here would total another club's takings for anyone who passed a
different id, which is why `01_tenant_isolation.test.sql` points each report at
another club and asserts it returns nothing.

Ranges are over the tenant-local **business date**, never a timestamp range, so
a club trading past midnight does not scatter its late sessions across two days.

## Payments are rows

A session used to carry one amount and one method. That is enough for a bill
paid once, in full, on the day it closed - which is the only case the columns
were ever shaped for. Two things break otherwise, and both are silent:

- **A split payment loses a method.** ₹150 cash and ₹150 by UPI became ₹300 by
  whichever came last.
- **A debt settled later lands in the wrong till.** `daily_cash_summary` read
  the _session's_ business date, so cash handed over on Friday for a Tuesday
  bill was counted into Tuesday. Friday's drawer would come up over by that
  amount, Tuesday's retrospectively short, and nothing in the schema would
  explain either. Nobody reports that as a bug; they conclude the app cannot
  count.

So `public.session_payments` holds one row per payment, with **its own**
`business_date` - the day the money arrived.

`sessions.paid_amount_minor`, `payment_status`, `payment_method` and `paid_at`
all still exist and every reader of them still works. What changed is that
nothing writes them any more: a trigger recomputes all four from the ledger, so
there is no code path that can add a payment without the total moving, or move
the total without a payment to explain it.

Three rules the table enforces itself:

| Rule                                                                  | Why                                                                                                                                                    |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `business_date` and `created_at` are always set from the server clock | A client that could pick either could post into a till already counted and signed off                                                                  |
| A payment may not exceed what is owed                                 | If a customer hands over more, that is change. Otherwise a fat-fingered amount creates a negative balance no screen can show                           |
| No `UPDATE`, ever                                                     | A payment is a fact about money that changed hands. The correction is to remove the wrong one and record the right one, which leaves both in the trail |

`WAIVED` is deliberately left alone by the sync trigger. It is a decision - "we
are not chasing this" - not an arithmetic outcome, and recomputing it from a
zero balance would quietly turn a waiver back into a debt.

### Two questions, two answers

The money functions look inconsistent until you notice they answer different
questions, so each one now says which:

| Function                 | Attributes by                  | Because                                                      |
| ------------------------ | ------------------------------ | ------------------------------------------------------------ |
| `daily_cash_summary`     | the day the **money arrived**  | The drawer holds what came in today                          |
| `report_revenue_summary` | the day the **trade happened** | Tuesday earned what Tuesday billed, whenever it is collected |

---

## Migration 0012: the business date belongs to the server

`sessions.business_date` has a default _and_ a trigger that always derives it.
The default exists so PostgREST marks the column optional; the trigger exists so
a supplied value is discarded. Together a client can neither omit it nor forge
it — verified by a test that sends `1999-01-01` and gets the correct date back.

`expenses.expense_date` deliberately keeps fill-if-null behaviour instead: an
expense legitimately belongs to a date the user chooses, such as recording
yesterday's electricity bill this morning.

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
