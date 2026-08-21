import { createClient } from 'jsr:@supabase/supabase-js@2';

import {
  batchSucceeded,
  buildMessages,
  chunk,
  deadTokensFromTickets,
  EXPO_PUSH_URL,
  summariseErrors,
  type ExpoTicket,
  type PendingNotification,
} from './expo.ts';

/**
 * The push delivery worker.
 *
 * This is the one part of the notification pipeline that cannot live in the
 * app. Sending an Expo push needs an access token, and any credential shipped
 * inside an APK is a credential in the hands of every user who can unzip it. So
 * the app registers device tokens and nothing else; this runs somewhere trusted
 * and holds the service role.
 *
 * It is a drain, not a stream: each invocation takes whatever is queued and
 * sends it. That makes it safe to call on a timer, safe to call twice, and safe
 * to have missed a run - the work is still there when it next wakes up.
 *
 * Recipients are resolved in SQL by `notifications_pending_push`, not here. Who
 * should receive a club's alert is a question about memberships, and the
 * database is the only thing that can answer it correctly.
 */

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const EXPO_ACCESS_TOKEN = Deno.env.get('EXPO_ACCESS_TOKEN') ?? '';
// Overridable so the pipeline can be exercised end to end against a stub
// without sending real notifications to real phones.
const PUSH_URL = Deno.env.get('EXPO_PUSH_URL') ?? EXPO_PUSH_URL;

interface DispatchResult {
  readonly pending: number;
  readonly messages: number;
  readonly batches: number;
  readonly delivered: number;
  readonly failed: number;
  readonly tokensRetired: number;
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method !== 'POST') {
    return json({ error: 'POST only' }, 405);
  }

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return json({ error: 'worker is not configured' }, 500);
  }

  try {
    const result = await dispatch();
    return json(result, 200);
  } catch (error) {
    console.error('[push-dispatch] failed', error);
    return json({ error: String(error) }, 500);
  }
});

async function dispatch(): Promise<DispatchResult> {
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase.rpc('notifications_pending_push', { p_limit: 200 });
  if (error) throw new Error(`could not read the queue: ${error.message}`);

  const pending = (data ?? []) as PendingNotification[];
  if (pending.length === 0) {
    return { pending: 0, messages: 0, batches: 0, delivered: 0, failed: 0, tokensRetired: 0 };
  }

  const messages = buildMessages(pending);
  const batches = chunk(messages);
  const notificationIds = pending.map((row) => row.notification_id);

  let delivered = 0;
  let failed = 0;
  const deadTokens = new Set<string>();
  const errors: string[] = [];

  for (const batch of batches) {
    try {
      const tickets = await send(batch);
      for (const token of deadTokensFromTickets(batch, tickets)) deadTokens.add(token);

      if (batchSucceeded(tickets)) {
        delivered += batch.length;
      } else {
        failed += batch.length;
      }

      const summary = summariseErrors(tickets);
      if (summary) errors.push(summary);
    } catch (error) {
      // A network failure is not the notification's fault. Count the attempt so
      // a permanently broken batch eventually stops, but leave it queued.
      failed += batch.length;
      errors.push(String(error).slice(0, 200));
    }
  }

  // One attempt is recorded per notification, whatever happened to its
  // individual devices. Marking per device would need a second table and would
  // still not change what the worker does next.
  const succeeded = delivered > 0 && failed === 0;
  const { error: markError } = await supabase.rpc('mark_notifications_pushed', {
    p_ids: notificationIds,
    p_success: succeeded,
    p_error: succeeded ? null : errors.join('; ').slice(0, 500) || 'delivery failed',
  });
  if (markError) throw new Error(`could not record the attempt: ${markError.message}`);

  let tokensRetired = 0;
  if (deadTokens.size > 0) {
    const { data: retired, error: retireError } = await supabase.rpc('deactivate_push_tokens', {
      p_tokens: [...deadTokens],
    });
    if (retireError) console.error('[push-dispatch] could not retire tokens', retireError.message);
    else tokensRetired = (retired as number) ?? 0;
  }

  console.log(
    `[push-dispatch] ${pending.length} queued → ${messages.length} messages in ` +
      `${batches.length} batches; ${delivered} delivered, ${failed} failed, ` +
      `${tokensRetired} tokens retired`,
  );

  return {
    pending: pending.length,
    messages: messages.length,
    batches: batches.length,
    delivered,
    failed,
    tokensRetired,
  };
}

async function send(batch: readonly unknown[]): Promise<ExpoTicket[]> {
  const response = await fetch(PUSH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Accept-Encoding': 'gzip, deflate',
      ...(EXPO_ACCESS_TOKEN ? { Authorization: `Bearer ${EXPO_ACCESS_TOKEN}` } : {}),
    },
    body: JSON.stringify(batch),
  });

  if (!response.ok) {
    throw new Error(`Expo returned ${response.status}: ${(await response.text()).slice(0, 200)}`);
  }

  const payload = (await response.json()) as { data?: ExpoTicket[]; errors?: unknown };
  if (!payload.data) {
    throw new Error(
      `Expo returned no tickets: ${JSON.stringify(payload.errors ?? {}).slice(0, 200)}`,
    );
  }

  return payload.data;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
