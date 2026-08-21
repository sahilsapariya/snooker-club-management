import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo } from 'react';

import { toAppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { queryKeys } from '@/lib/query';
import { supabase } from '@/lib/supabase';
import { useActiveClubStore } from '@/stores/active-club.store';
import { useAuthStore } from '@/stores/auth.store';

import { signInWithPassword, signOut, type SignInCredentials } from '../api/auth.api';
import { fetchBillingSettings, resolveSessionIdentity } from '../api/session-context.api';
import { isOperable, type AppSessionState } from '../model/types';
import { resolveActiveClub } from './use-active-club';

const log = logger.child('auth:session');

/**
 * Binds Supabase's auth subscription to the store, and restores the last active
 * club. Mounted once, by the root provider.
 */
export function useAuthListener(): void {
  const setSession = useAuthStore((state) => state.setSession);
  const setSignedOut = useAuthStore((state) => state.setSignedOut);
  const hydrateActiveClub = useActiveClubStore((state) => state.hydrate);
  const clearActiveClub = useActiveClubStore((state) => state.clear);
  const queryClient = useQueryClient();

  useEffect(() => {
    void hydrateActiveClub();
  }, [hydrateActiveClub]);

  useEffect(() => {
    let active = true;

    void supabase.auth.getSession().then(({ data }) => {
      if (active) setSession(data.session);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((event, session) => {
      log.debug('Auth state changed', { event });

      if (event === 'SIGNED_OUT') {
        // Drop every cached row AND the remembered club on sign-out. Without
        // this, the next user on a shared counter device could momentarily see
        // the previous club's data, or land straight in their club.
        queryClient.clear();
        clearActiveClub();
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
  }, [setSession, setSignedOut, clearActiveClub, queryClient]);
}

/**
 * The single source of truth for "who is using the app, and which club".
 *
 * Three inputs, deliberately separate:
 *
 *   auth session   client state — who is signed in
 *   identity       server state — which clubs they may reach, keyed by user
 *   active club    client state — which of those they are operating
 *
 * Keeping identity keyed by user rather than by club is what makes switching
 * cheap: changing club refetches that club's data, never the membership set.
 */
export function useAppSession(): AppSessionState {
  const status = useAuthStore((state) => state.status);
  const userId = useAuthStore((state) => state.session?.user.id ?? null);
  const signOutReason = useAuthStore((state) => state.lastSignOutReason);
  const storedTenantId = useActiveClubStore((state) => state.tenantId);
  const clubHydrated = useActiveClubStore((state) => state.hydrated);
  const clearActiveClub = useActiveClubStore((state) => state.clear);

  const identityQuery = useQuery({
    queryKey: queryKeys.sessionContext(userId ?? 'anonymous'),
    queryFn: () => resolveSessionIdentity(userId as string),
    enabled: status === 'signed-in' && userId !== null,
    // Membership changes rarely, and a stale read here would show the wrong
    // shell. Refetched explicitly after a role or club change instead.
    staleTime: 5 * 60_000,
    retry: 1,
  });

  const clubs = useMemo(() => identityQuery.data?.clubs ?? [], [identityQuery.data]);
  const operable = useMemo(() => clubs.filter(isOperable), [clubs]);
  const activeClub = useMemo(
    () => resolveActiveClub(operable, storedTenantId),
    [operable, storedTenantId],
  );

  // A remembered club that is no longer reachable — membership removed, or the
  // club suspended — must not linger, or the selector would keep re-choosing it.
  useEffect(() => {
    if (!clubHydrated || !storedTenantId || identityQuery.isPending) return;
    if (!operable.some((club) => club.tenant.id === storedTenantId)) {
      log.info('Stored club is no longer reachable; clearing', { tenantId: storedTenantId });
      clearActiveClub();
    }
  }, [clubHydrated, storedTenantId, operable, identityQuery.isPending, clearActiveClub]);

  const billingQuery = useQuery({
    queryKey: queryKeys.billing.settings(activeClub?.tenant.id ?? 'none'),
    queryFn: () => fetchBillingSettings(activeClub?.tenant.id as string),
    enabled: activeClub !== null,
    staleTime: 5 * 60_000,
  });

  if (status === 'initialising' || !clubHydrated) return { status: 'loading' };

  if (status === 'signed-out' || userId === null) {
    return signOutReason === 'session-expired'
      ? { status: 'unauthenticated', reason: 'session-expired' }
      : { status: 'unauthenticated' };
  }

  if (identityQuery.isPending) return { status: 'loading' };
  if (identityQuery.isError) return { status: 'error', error: toAppError(identityQuery.error) };

  const identity = identityQuery.data;
  if (!identity) return { status: 'loading' };

  if (!identity.profile.is_active) {
    return { status: 'account-disabled', profile: identity.profile };
  }

  if (identity.platformAdmin) {
    return {
      status: 'platform-admin',
      profile: identity.profile,
      platformRole: identity.platformAdmin.role,
    };
  }

  if (clubs.length === 0) {
    return { status: 'no-tenant', profile: identity.profile };
  }

  // Belongs to clubs, but every one of them is suspended or archived. Show the
  // first so the app can name it rather than rendering an empty shell.
  if (operable.length === 0) {
    const first = clubs[0];
    if (first)
      return { status: 'tenant-suspended', profile: identity.profile, tenant: first.tenant };
    return { status: 'no-tenant', profile: identity.profile };
  }

  if (!activeClub) {
    return { status: 'club-selection', profile: identity.profile, clubs: operable };
  }

  return {
    status: 'tenant-user',
    profile: identity.profile,
    tenant: activeClub.tenant,
    membership: activeClub.membership,
    role: activeClub.role,
    billingSettings: billingQuery.data ?? null,
    clubs: operable,
    canSwitchClubs: operable.length > 1,
  };
}

export function useSignIn() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (credentials: SignInCredentials) => signInWithPassword(credentials),
    onSuccess: async (session) => {
      // Resolve identity before the router moves, so the first frame after
      // sign-in is already the right shell rather than a flash of the wrong one.
      await queryClient.prefetchQuery({
        queryKey: queryKeys.sessionContext(session.user.id),
        queryFn: () => resolveSessionIdentity(session.user.id),
      });
    },
  });
}

export function useSignOut() {
  const queryClient = useQueryClient();
  const clearActiveClub = useActiveClubStore((state) => state.clear);

  return useCallback(async () => {
    await signOut();
    clearActiveClub();
    queryClient.clear();
  }, [queryClient, clearActiveClub]);
}

/** Re-reads identity, e.g. after the platform grants access to another club. */
export function useRefreshSessionContext() {
  const queryClient = useQueryClient();
  const userId = useAuthStore((state) => state.session?.user.id ?? null);

  return useCallback(async () => {
    if (!userId) return;
    await queryClient.invalidateQueries({ queryKey: queryKeys.sessionContext(userId) });
  }, [queryClient, userId]);
}
