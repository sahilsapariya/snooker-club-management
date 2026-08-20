import type { Session } from '@supabase/supabase-js';
import { create } from 'zustand';

export type AuthStatus = 'initialising' | 'signed-in' | 'signed-out';

interface AuthState {
  readonly status: AuthStatus;
  readonly session: Session | null;
  /** Set when a session ended unexpectedly, so the login screen can say why. */
  readonly lastSignOutReason: 'signed-out' | 'session-expired' | null;
  setSession(session: Session | null): void;
  setSignedOut(reason: 'signed-out' | 'session-expired'): void;
}

/**
 * Raw authentication state, and nothing else.
 *
 * The deliberate split in this app:
 *
 *   Zustand           auth state (this store) and UI state
 *   TanStack Query    everything that came from Postgres
 *
 * The Supabase session object is genuinely client state: it is restored from
 * secure storage, mutated by a subscription, and read synchronously during
 * navigation. The user's role, club and profile are server state and live in
 * the query cache instead, keyed by user id, so signing in as somebody else
 * cannot show the previous user's club from memory.
 */
export const useAuthStore = create<AuthState>((set) => ({
  status: 'initialising',
  session: null,
  lastSignOutReason: null,

  setSession: (session) =>
    set(
      session
        ? { status: 'signed-in', session, lastSignOutReason: null }
        : { status: 'signed-out', session: null, lastSignOutReason: 'signed-out' },
    ),

  setSignedOut: (reason) => set({ status: 'signed-out', session: null, lastSignOutReason: reason }),
}));

export const selectUserId = (state: AuthState): string | null => state.session?.user.id ?? null;
