import * as Notifications from 'expo-notifications';

import { logger } from '@/lib/logger';
import type { Database } from '@/types/database.types';

const log = logger.child('notifications');

export type NotificationType = Database['public']['Enums']['notification_type'];

/**
 * The events this product raises.
 *
 * Declared as one typed union so that the in-app inbox, the local notification
 * presenter and the future server-side push worker all agree on the payload -
 * adding an event is a change in one place, not three.
 */
export type ClubNotification =
  | { readonly type: 'SESSION_STARTED'; readonly tableName: string; readonly sessionId: string }
  | {
      readonly type: 'SESSION_TIME_COMPLETED';
      readonly tableName: string;
      readonly sessionId: string;
      readonly bookedMinutes: number;
    }
  | {
      readonly type: 'SESSION_CLOSED';
      readonly tableName: string;
      readonly sessionId: string;
      readonly totalMinor: number;
    }
  | {
      readonly type: 'PAYMENT_RECEIVED';
      readonly sessionId: string;
      readonly amountMinor: number;
      readonly method: string;
    }
  | {
      readonly type: 'LOW_STOCK';
      readonly productName: string;
      readonly productId: string;
      readonly remaining: number;
    }
  | { readonly type: 'CASH_CLOSING_REMINDER'; readonly businessDate: string }
  | { readonly type: 'SYSTEM_ALERT'; readonly title: string; readonly body: string };

export interface RenderedNotification {
  readonly title: string;
  readonly body: string;
}

/** Single place where an event becomes words. Kept out of components. */
export function renderNotification(notification: ClubNotification): RenderedNotification {
  switch (notification.type) {
    case 'SESSION_STARTED':
      return { title: `${notification.tableName} is in play`, body: 'A session has been started.' };
    case 'SESSION_TIME_COMPLETED':
      return {
        title: `${notification.tableName}: booked time is up`,
        body: `The ${notification.bookedMinutes} minute booking has elapsed. The session is still running until you close it.`,
      };
    case 'SESSION_CLOSED':
      return { title: `${notification.tableName} is free`, body: 'The session has been closed.' };
    case 'PAYMENT_RECEIVED':
      return { title: 'Payment received', body: `Paid by ${notification.method.toLowerCase()}.` };
    case 'LOW_STOCK':
      return {
        title: `${notification.productName} is running low`,
        body: `${notification.remaining} left in stock.`,
      };
    case 'CASH_CLOSING_REMINDER':
      return {
        title: 'Cash closing is due',
        body: `The till for ${notification.businessDate} has not been reconciled yet.`,
      };
    case 'SYSTEM_ALERT':
      return { title: notification.title, body: notification.body };
  }
}

/**
 * How a notification behaves while the app is open.
 *
 * Operational alerts are worth interrupting for - a table whose time is up
 * needs someone to look at it now.
 */
export function configureForegroundBehaviour(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
    }),
  });
}

/**
 * Shows a notification from the device itself.
 *
 * Used for events the app already knows about locally (a booked time elapsing
 * while the app is open). Anything that must reach a phone with the app closed
 * goes through the server-side push path instead.
 */
export async function presentLocalNotification(notification: ClubNotification): Promise<void> {
  const { title, body } = renderNotification(notification);
  try {
    await Notifications.scheduleNotificationAsync({
      content: { title, body, data: { ...notification } },
      trigger: null,
    });
  } catch (error) {
    log.warn('Could not present a local notification', { error: String(error) });
  }
}
