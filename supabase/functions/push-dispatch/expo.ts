/**
 * The Expo Push protocol, as pure functions.
 *
 * Kept separate from `index.ts` so the parts with rules in them - batching,
 * message shape, deciding what a failure means - can be read and reasoned about
 * without a running database or a network.
 */

/** Expo accepts at most this many messages in one request. */
export const EXPO_BATCH_SIZE = 100;

export const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

export interface PendingNotification {
  readonly notification_id: string;
  readonly tenant_id: string;
  readonly type: string;
  readonly title: string;
  readonly body: string | null;
  readonly entity_type: string | null;
  readonly entity_id: string | null;
  readonly metadata: Record<string, unknown>;
  readonly created_at: string;
  readonly tokens: readonly string[];
}

export interface ExpoMessage {
  readonly to: string;
  readonly title: string;
  readonly body: string;
  readonly data: Record<string, unknown>;
  readonly channelId: string;
  readonly priority: 'default' | 'high';
  readonly sound: 'default';
}

export interface ExpoTicket {
  readonly status: 'ok' | 'error';
  readonly id?: string;
  readonly message?: string;
  readonly details?: { readonly error?: string };
}

/**
 * One message per device.
 *
 * The payload carries identifiers, never club data. A push sits in a
 * notification tray and in the OS's own logs; the app fetches the detail after
 * the user taps, over an authenticated connection that RLS still governs.
 *
 * `channelId` matches the Android channel the app creates at startup
 * (`operations`, HIGH importance). A mismatch silently downgrades every
 * notification to the default channel.
 */
export function buildMessages(pending: readonly PendingNotification[]): ExpoMessage[] {
  const messages: ExpoMessage[] = [];

  for (const notification of pending) {
    for (const token of notification.tokens) {
      messages.push({
        to: token,
        title: notification.title,
        body: notification.body ?? '',
        data: {
          notificationId: notification.notification_id,
          tenantId: notification.tenant_id,
          type: notification.type,
          entityType: notification.entity_type,
          entityId: notification.entity_id,
        },
        channelId: 'operations',
        // A table whose booked time is up needs somebody to look at it now.
        priority: notification.type === 'SESSION_TIME_COMPLETED' ? 'high' : 'default',
        sound: 'default',
      });
    }
  }

  return messages;
}

export function chunk<T>(items: readonly T[], size = EXPO_BATCH_SIZE): T[][] {
  if (size < 1) throw new RangeError('chunk size must be at least 1');

  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}

/**
 * Which tokens Expo has told us are dead.
 *
 * Tickets and receipts are two separate stages, and `DeviceNotRegistered`
 * usually arrives in the *receipt* rather than the ticket. This reads the
 * tickets, which catches the subset Expo rejects immediately; the receipt pass
 * is not implemented (see docs/notifications.md). Anything found here is worth
 * retiring straight away.
 */
export function deadTokensFromTickets(
  messages: readonly ExpoMessage[],
  tickets: readonly ExpoTicket[],
): string[] {
  const dead = new Set<string>();

  // Expo returns tickets positionally against the messages sent.
  const length = Math.min(messages.length, tickets.length);
  for (let index = 0; index < length; index += 1) {
    const ticket = tickets[index];
    const message = messages[index];
    if (!ticket || !message) continue;
    if (ticket.status === 'error' && ticket.details?.error === 'DeviceNotRegistered') {
      dead.add(message.to);
    }
  }

  return [...dead];
}

/**
 * Whether a batch counts as delivered.
 *
 * A batch is a success if Expo accepted it at all. Individual per-device
 * failures - a retired handset, a revoked permission - are not a reason to keep
 * re-sending the same alert to everybody else on the broadcast, and retrying
 * would deliver it twice to the devices that did receive it.
 */
export function batchSucceeded(tickets: readonly ExpoTicket[]): boolean {
  return tickets.length > 0 && tickets.some((ticket) => ticket.status === 'ok');
}

/** Summarises per-ticket errors for `notifications.push_error`. */
export function summariseErrors(tickets: readonly ExpoTicket[]): string | null {
  const errors = tickets
    .filter((ticket) => ticket.status === 'error')
    .map((ticket) => ticket.details?.error ?? ticket.message ?? 'unknown')
    .filter((value, index, all) => all.indexOf(value) === index);

  return errors.length === 0 ? null : errors.join(', ').slice(0, 500);
}
