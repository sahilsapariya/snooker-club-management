# Notifications

Two channels, one event model.

- **In-app inbox** — `public.notifications`, tenant-scoped, works today.
- **Push** — Expo Push. Tokens are captured and stored today; **delivery is not
  implemented** and is the one piece that must live server-side.

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

## Events

`src/features/notifications/notification-service.ts` declares every event as one
typed union, so the inbox, the local presenter and the future worker cannot drift
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

`renderNotification()` is the single place an event becomes words, so
"Time up" reads identically in the table list, the session sheet and the push.

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

## What is missing

A server-side worker. Sketch:

```
Postgres trigger / pg_cron / Realtime
        │  new row in public.notifications
        ▼
Worker  (Supabase Edge Function, or any trusted process)
        │  service role key, held server-side only
        ├─ resolve recipients
        │     recipient_user_id IS NULL → every active member of the tenant
        │     otherwise                 → that user
        ├─ read device_push_tokens WHERE is_active
        ├─ POST https://exp.host/--/api/v2/push/send   (batches of 100)
        └─ handle receipts: DeviceNotRegistered → set is_active = false
```

Notes for whoever builds it:

- Expo accepts up to 100 messages per request; batch.
- Receipts are fetched separately and are the only reliable way to learn a token
  is dead. Deactivate rather than delete, so the audit trail survives.
- Make it idempotent — mark the notification row as pushed, or key on its id.
- Respect `tenant_billing_settings.notify_on_time_completed`,
  `notify_on_payment` and `low_stock_alerts_enabled`.
- Never send club data in the payload beyond what the title and body need; the
  app fetches details after the user taps.

---

## Requirements to actually deliver

| Need              | Status                                             |
| ----------------- | -------------------------------------------------- |
| Development build | required — Expo Go cannot receive remote push      |
| EAS project id    | `eas init`; read from `expo.extra.eas.projectId`   |
| Android channel   | created at startup (`operations`, HIGH importance) |
| iOS APNs key      | uploaded to Expo, needs an Apple Developer account |
| Server worker     | not built                                          |

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
