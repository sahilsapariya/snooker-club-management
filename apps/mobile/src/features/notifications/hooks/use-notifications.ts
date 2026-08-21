import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { unwrap } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { queryKeys } from '@/lib/query';
import { supabase } from '@/lib/supabase';
import type { Database } from '@/types/database.types';

import {
  configureAndroidChannel,
  deactivateDeviceToken,
  getExpoPushToken,
  registerDeviceToken,
} from '../api/push.api';
import { configureForegroundBehaviour } from '../notification-service';

const log = logger.child('notifications');

export type NotificationRow = Database['public']['Tables']['notifications']['Row'];

export function useNotificationInbox(tenantId: string | null) {
  return useQuery({
    queryKey: queryKeys.notifications.inbox(tenantId ?? 'none'),
    queryFn: async (): Promise<NotificationRow[]> => {
      const result = await supabase
        .from('notifications')
        .select('*')
        .eq('tenant_id', tenantId as string)
        .order('created_at', { ascending: false })
        .limit(50);
      return unwrap(result, 'load notifications') ?? [];
    },
    enabled: tenantId !== null,
    staleTime: 30_000,
  });
}

/**
 * How many alerts this club has that nobody has looked at.
 *
 * A separate query from the inbox, using `head: true` so it costs a count and
 * not the rows: the tab badge is mounted on every screen, and the inbox itself
 * is only mounted when somebody opens it.
 *
 * The count is what RLS returns, so it is already the right number for this
 * user - a receptionist does not see, or count, an owner-only alert.
 */
export function useUnreadNotificationCount(tenantId: string | null) {
  return useQuery({
    queryKey: queryKeys.notifications.unreadCount(tenantId ?? 'none'),
    queryFn: async (): Promise<number> => {
      const { count, error } = await supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId as string)
        .is('read_at', null);

      if (error) throw error;
      return count ?? 0;
    },
    enabled: tenantId !== null,
    staleTime: 30_000,
    // Alerts are the one thing worth chasing without a user action: a table
    // whose time is up needs somebody to notice while it still matters.
    refetchInterval: 60_000,
  });
}

export function useMarkNotificationRead(tenantId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (notificationId: string) => {
      const result = await supabase
        .from('notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('id', notificationId)
        .select('id')
        .maybeSingle();
      return unwrap(result, 'mark notification read');
    },
    onSuccess: async () => {
      if (!tenantId) return;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.notifications.inbox(tenantId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.notifications.unreadCount(tenantId) }),
      ]);
    },
  });
}

/**
 * Registers this device for push once a user and club are known.
 *
 * Runs at most once per signed-in session. Failure is never fatal: a device
 * without push still shows the in-app inbox, so this only logs and moves on.
 */
export function usePushRegistration(userId: string | null, tenantId: string | null): void {
  const registeredToken = useRef<string | null>(null);

  useEffect(() => {
    configureForegroundBehaviour();
    void configureAndroidChannel();
  }, []);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    void (async () => {
      const { token, reason } = await getExpoPushToken();
      if (cancelled) return;

      if (!token) {
        log.info('Push registration skipped', { reason });
        return;
      }

      try {
        await registerDeviceToken({ userId, tenantId, expoPushToken: token });
        registeredToken.current = token;
      } catch (error) {
        log.warn('Could not register this device for push', { error: String(error) });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userId, tenantId]);

  useEffect(() => {
    return () => {
      // Clubs share devices; a token left active would keep delivering the
      // previous user's alerts to whoever signs in next.
      const token = registeredToken.current;
      if (token) void deactivateDeviceToken(token).catch(() => undefined);
    };
  }, []);
}
