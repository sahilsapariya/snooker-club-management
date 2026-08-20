import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';

import { toAppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { queryKeys } from '@/lib/query';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth.store';

import { signInWithPassword, signOut, type SignInCredentials } from '../api/auth.api';
import { resolveSessionContext } from '../api/session-context.api';
import type { AppSessionState } from '../model/types';

const log = logger.child('auth:session');

/**
 * Binds Supabase's auth subscription to the store. Mounted once, by the root
 * provider.
 *
 * `onAuthStateChange` fires on restore, refresh, sign-in and sign-out, so the
 * app never has to poll for session validity or guess when a token expired.
 */
export function useAuthListener(): void {
  const setSession = useAuthStore((state) => state.setSession);
  const setSignedOut = useAuthStore((state) => state.setSignedOut);
  const queryClient = useQueryClient();

  useEffect(() => {
    let active = true;

    void supabase.auth.getSession().then(({ data }) => {
      if (active) setSession(data.session);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((event, session) => {
      log.debug('Auth state changed', { event });

      if (event === 'SIGNED_OUT') {
        // Drop every cached row on sign-out. Without this, the next user to
        // sign in on this device could momentarily see the previous club's
        // data from the query cache before the refetch lands.
        queryClient.clear();
        setSignedOut('signed-out');
        return;
      }

      if (event === 'TOKEN_REFRESHED' && !session) {
        queryClient.clear();
        setSignedOut('session-expired');
        return;
      }

      setSession(session);
    });

    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, [setSession, setSignedOut, queryClient]);
}

/**
 * The single source of truth for "who is using the app right now".
 *
 * Combines the raw auth session (client state) with the resolved role, club and
 * branding (server state), and hands back one closed union that layouts and
 * screens can switch on.
 */
export function useAppSession(): AppSessionState {
  const status = useAuthStore((state) => state.status);
  const userId = useAuthStore((state) => state.session?.user.id ?? null);
  const signOutReason = useAuthStore((state) => state.lastSignOutReason);

  const contextQuery = useQuery({
    queryKey: queryKeys.sessionContext(userId ?? 'anonymous'),
    queryFn: () => resolveSessionContext(userId as string),
    enabled: status === 'signed-in' && userId !== null,
    // Role and club membership change rarely, and a stale read here would show
    // the wrong shell. Refetched explicitly after a role change instead.
    staleTime: 5 * 60_000,
    retry: 1,
  });

  if (status === 'initialising') return { status: 'loading' };

  if (status === 'signed-out' || userId === null) {
    return signOutReason === 'session-expired'
      ? { status: 'unauthenticated', reason: 'session-expired' }
      : { status: 'unauthenticated' };
  }

  if (contextQuery.isPending) return { status: 'loading' };

  if (contextQuery.isError) {
    return { status: 'error', error: toAppError(contextQuery.error) };
  }

  return contextQuery.data ?? { status: 'loading' };
}

export function useSignIn() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (credentials: SignInCredentials) => signInWithPassword(credentials),
    onSuccess: async (session) => {
      // Resolve role and club before the router moves, so the first frame after
      // sign-in is already the right shell rather than a flash of the wrong one.
      await queryClient.prefetchQuery({
        queryKey: queryKeys.sessionContext(session.user.id),
        queryFn: () => resolveSessionContext(session.user.id),
      });
    },
  });
}

export function useSignOut() {
  const queryClient = useQueryClient();

  return useCallback(async () => {
    await signOut();
    queryClient.clear();
  }, [queryClient]);
}

/** Re-reads role, club and branding, e.g. after the platform admin changes them. */
export function useRefreshSessionContext() {
  const queryClient = useQueryClient();
  const userId = useAuthStore((state) => state.session?.user.id ?? null);

  return useCallback(async () => {
    if (!userId) return;
    await queryClient.invalidateQueries({ queryKey: queryKeys.sessionContext(userId) });
  }, [queryClient, userId]);
}
