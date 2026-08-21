# Notifications

Two channels, one event model.

- **In-app inbox** — `public.notifications`, tenant-scoped.
- **Push** — Expo Push, delivered by the `push-dispatch` Edge Function.

```
 a write happens ─────► trigger (0019) ─────► public.notifications
 pg_cron / scheduler ─► app.sweep_time_completed_sessions()  ─┘
                        app.remind_unclosed_tills()

 public.notifications ──► notifications_pending_push()  (recipients resolved in SQL)
                            │
                            ▼
                     push-dispatch  (Edge Function, service role)
                            │  batches of 100 → exp.host
                            ├─ mark_notifications_pushed()
                            └─ deactivate_push_tokens()   ← DeviceNotRegistered
```

Both ends were missing until migrations `0019`–`0021`: the inbox, its policies
and its guard were all correct, but nothing ever wrote to the table, so the
Alerts tab was empty for reasons no test could catch.

---

## Why delivery is not in the app

Sending an Expo push requires an Expo access token (or, going direct, FCM server
keys and APNs keys). Any credential shipped inside the app is a credential in the
hands of every user who can unzip an APK.

So the app does exactly two things:

1. asks for permission and obtains this device's Expo push token, and
2. writes that token to `device_push_tokens` under its own `user_id`.

RLS on that table is `user_id = auth.uid()` for all four verbs, so a device can
only ever register itself.

---

## Raising an event

Events are raised by database triggers, not by the app. Three reasons, in order
of how much they matter:

- **A receptionist's phone is not always open.** Anything raised client-side is
  raised only for whoever happens to be looking at the screen.
- **The database sees every write.** A session closed from a second device, or
  by a future integration, still raises the event.
- **The actor is knowable there.** A receptionist who closes a session should
  not be told that a session was closed — they just closed it. Every
  owner-targeted event excludes the person who caused it.

`app.notify_club(tenant, type, title, body, audience, …)` is the only way a
notification comes into existence. The audience is `EVERYONE` or `OWNERS`, and
the difference is not cosmetic:

| Audience   | Rows written                  | Who can read it                              |
| ---------- | ----------------------------- | -------------------------------------------- |
| `EVERYONE` | one, `recipient_user_id` NULL | any member of the club — whoever is on shift |
| `OWNERS`   | one per active owner          | only the user each row names                 |

A club may now have several owners, so `OWNERS` is a fan-out rather than a
single row. And the select policy admits a targeted row only to the user it
names — getting the audience wrong is a disclosure, not a display bug.

## Events

`src/features/notifications/notification-service.ts` declares every event as one
typed union, so the inbox, the local presenter and the worker cannot drift
apart:

| Type                     | Raised when                      | Goes to          |
| ------------------------ | -------------------------------- | ---------------- |
| `SESSION_STARTED`        | a table goes into play           | owner            |
| `SESSION_TIME_COMPLETED` | the booked time elapses          | everyone on duty |
| `SESSION_CLOSED`         | a receptionist closes a session  | owner            |
| `PAYMENT_RECEIVED`       | payment recorded                 | owner            |
| `LOW_STOCK`              | stock reaches its threshold      | everyone         |
| `CASH_CLOSING_REMINDER`  | the till has not been reconciled | owner            |
| `SYSTEM_ALERT`           | platform announcements           | everyone         |

### Wording lives in two places, narrowly

`renderNotification()` in the app renders the one event the app can see itself —
a booked time elapsing while it is in the foreground. Everything persisted or
pushed is worded by the SQL in `0019`. The two must read identically; if you
change one, change the other.

Every title names its club. On a lock screen there is no active club to infer
from, and one owner may run four — "Table 3's time is up" without a club name is
worse than no notification at all.

`SESSION_TIME_COMPLETED` is worded carefully: _"The 60 minute booking has
elapsed. The session is still running until you close it."_ The notification
reports a state; it never implies the app ended anything.

---

## What exists

```
src/features/notifications/
├── api/push.api.ts             permission, token, register/deactivate
├── notification-service.ts     event union, rendering, foreground behaviour
└── hooks/use-notifications.ts  inbox query, mark-read mutation, registration
```

`usePushRegistration(userId, tenantId)` runs once per signed-in session from the
tenant layout. Failure is never fatal — a device without push still has the
in-app inbox, so it logs and moves on.

On unmount it deactivates the token. Clubs share devices; a token left active
would keep delivering the previous user's alerts to whoever signs in next.

---

## The delivery worker

`supabase/functions/push-dispatch/`. It holds the service role and, in
production, the Expo access token — which is exactly why it is not in the app.

It is a **drain, not a stream**: each invocation takes whatever is queued and
sends it. That makes it safe to call on a timer, safe to call twice, and safe to
have missed a run — the work is still there when it next wakes up.

```bash
supabase functions deploy push-dispatch
supabase secrets set EXPO_ACCESS_TOKEN=...        # optional but recommended
```

Then call it on a schedule. With `pg_cron` and `pg_net` enabled:

```sql
-- the pure-SQL jobs: flag elapsed bookings, nag about unreconciled tills
select cron.schedule('club-desk-maintenance', '* * * * *',
  $$select public.run_scheduled_maintenance()$$);

-- and the dispatcher
select cron.schedule('club-desk-push', '* * * * *', $$
  select net.http_post(
    url     := 'https://<project>.supabase.co/functions/v1/push-dispatch',
    headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.service_role_key'),
                                  'Content-Type', 'application/json'),
    body    := '{}'::jsonb)
$$);
```

### What it does, and what it deliberately does not

**Recipients are resolved in SQL**, by `notifications_pending_push()`, not in the
worker. Who should receive a club's alert is a question about memberships, and
the database is the only thing that can answer it correctly.

Note what devices are found by: `user_id`, **never**
`device_push_tokens.tenant_id`. That column records the club a device was last
used in and is re-pointed on every club switch. Filtering by it would silently
stop delivering to an owner for every club they are not currently looking at —
which, for someone running four clubs, is three of them.

`notifications_pending_push` also skips: notifications already read in the app,
clubs the platform has suspended, rows older than an hour (a worker outage must
not dump a day of stale alerts onto a phone at 3am), and rows that have already
failed three times.

`mark_notifications_pushed` counts the attempt whether or not the send worked,
and sets `pushed_at` only on success — so "sent" and "given up on" stay legible
in the table rather than needing a log.

### Not implemented: the receipt pass

Expo has two stages. **Tickets** come back immediately; **receipts** are fetched
later by ticket id, and `DeviceNotRegistered` usually arrives in the _receipt_
rather than the ticket.

`deadTokensFromTickets` handles the ticket case, which catches the subset Expo
rejects outright. The receipt pass is not built: it needs somewhere to store
ticket ids between the send and the poll, and the value of that is marginal
until there is real traffic. Until it exists, some dead tokens will stay active
and be sent to harmlessly.

### Not resolved: the double banner

While the app is in the foreground, the client's own `presentLocalNotification`
fires _and_ the push arrives. Both will show. The fix is for the foreground
handler to suppress a push whose `data.notificationId` is already in the inbox —
but that needs a development build to test on, so it is deliberately left until
push is actually running end to end on a device.

---

## Requirements to actually deliver

| Need              | Status                                             |
| ----------------- | -------------------------------------------------- |
| Development build | required — Expo Go cannot receive remote push      |
| EAS project id    | `eas init`; read from `expo.extra.eas.projectId`   |
| Android channel   | created at startup (`operations`, HIGH importance) |
| iOS APNs key      | uploaded to Expo, needs an Apple Developer account |
| Server worker     | **built** — `supabase/functions/push-dispatch`     |
| Expo access token | set as a Supabase secret; never in the app         |
| Scheduler         | `pg_cron` + `pg_net`, or any external timer        |

Until then, `presentLocalNotification()` covers events the app can see while it
is open — such as a booked time elapsing with the app in the foreground.

---

## Testing

```sql
-- raise a broadcast notification for a club
insert into public.notifications (tenant_id, type, title, body)
values ('<tenant-uuid>', 'LOW_STOCK', 'Cola 300ml is running low',
        'Stock has fallen to or below the configured threshold.');

-- check which devices would receive it
select p.email, d.platform, d.device_name, d.is_active
from public.device_push_tokens d
join public.profiles p on p.id = d.user_id
where d.tenant_id = '<tenant-uuid>';
```

The row appears in the Alerts tab immediately. Marking it read is restricted to
the recipient, and `app.notifications_guard` ensures that "mark as read" cannot
be used to rewrite the message itself.
