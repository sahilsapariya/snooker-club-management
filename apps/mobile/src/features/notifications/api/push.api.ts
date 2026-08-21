import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { unwrap } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { supabase } from '@/lib/supabase';
import type { Database } from '@/types/database.types';

const log = logger.child('push');

type DevicePlatform = Database['public']['Enums']['device_platform'];

/**
 * Push notification foundation.
 *
 * What lives here: asking for permission, obtaining the device's Expo push
 * token, and registering that token against the signed-in user.
 *
 * What deliberately does NOT live here: sending. Delivery needs an Expo access
 * token (or FCM/APNs credentials), and any credential shipped inside the app is
 * a credential in the hands of every user. A trusted server-side worker reads
 * `device_push_tokens` and sends; see docs/notifications.md.
 */

export interface PushRegistrationResult {
  readonly token: string | null;
  readonly reason?: 'not-a-device' | 'permission-denied' | 'no-project-id' | 'failed';
}

function currentPlatform(): DevicePlatform {
  if (Platform.OS === 'ios') return 'IOS';
  if (Platform.OS === 'android') return 'ANDROID';
  return 'WEB';
}

/** Android needs a channel before any notification can be shown. */
export async function configureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('operations', {
    name: 'Club operations',
    importance: Notifications.AndroidImportance.HIGH,
    sound: 'default',
  });
}

export async function requestPushPermission(): Promise<boolean> {
  const existing = await Notifications.getPermissionsAsync();
  if (existing.status === 'granted') return true;
  if (!existing.canAskAgain) return false;

  const requested = await Notifications.requestPermissionsAsync();
  return requested.status === 'granted';
}

export async function getExpoPushToken(): Promise<PushRegistrationResult> {
  if (!Device.isDevice) {
    // Simulators cannot receive remote push.
    return { token: null, reason: 'not-a-device' };
  }

  const granted = await requestPushPermission();
  if (!granted) return { token: null, reason: 'permission-denied' };

  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? null;

  if (!projectId) {
    // Expected until `eas init` has been run; local development still works
    // with in-app notifications.
    log.info('No EAS project id, skipping remote push registration');
    return { token: null, reason: 'no-project-id' };
  }

  try {
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
    return { token: data };
  } catch (error) {
    log.warn('Could not obtain an Expo push token', { error: String(error) });
    return { token: null, reason: 'failed' };
  }
}

/**
 * Stores or refreshes this device's token.
 *
 * RLS restricts `device_push_tokens` to `user_id = auth.uid()`, so a device can
 * only ever register itself.
 *
 * `tenant_id` records the club the device was last used in, and is re-pointed
 * on every club switch (the upsert conflicts on the token). It is a hint, not a
 * routing key: an owner running three clubs carries one phone and must hear
 * about all three, so the delivery worker should resolve recipients from the
 * notification's tenant through `tenant_memberships`, then find their devices
 * by `user_id`. Filtering devices by this column would silently stop delivering
 * every club an owner is not currently looking at. See docs/notifications.md.
 */
export async function registerDeviceToken(params: {
  readonly userId: string;
  readonly tenantId: string | null;
  readonly expoPushToken: string;
}): Promise<void> {
  const result = await supabase
    .from('device_push_tokens')
    .upsert(
      {
        user_id: params.userId,
        tenant_id: params.tenantId,
        expo_push_token: params.expoPushToken,
        platform: currentPlatform(),
        device_name: Device.deviceName ?? null,
        app_version: Constants.expoConfig?.version ?? null,
        is_active: true,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: 'expo_push_token' },
    )
    .select('id')
    .maybeSingle();

  unwrap(result, 'register push token');
  log.info('Device registered for push');
}

/** Called on sign-out so a shared device stops receiving the previous user's alerts. */
export async function deactivateDeviceToken(expoPushToken: string): Promise<void> {
  const result = await supabase
    .from('device_push_tokens')
    .update({ is_active: false })
    .eq('expo_push_token', expoPushToken)
    .select('id')
    .maybeSingle();

  unwrap(result, 'deactivate push token');
}
