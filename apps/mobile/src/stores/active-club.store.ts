import { create } from 'zustand';

import { logger } from '@/lib/logger';
import { sessionStorage } from '@/lib/supabase';

const log = logger.child('active-club');

const STORAGE_KEY = 'clubdesk.active-club';

interface ActiveClubState {
  /** The club the user is currently operating, or null if none is chosen. */
  readonly tenantId: string | null;
  /** False until the persisted value has been read back from storage. */
  readonly hydrated: boolean;
  hydrate(): Promise<void>;
  select(tenantId: string): void;
  clear(): void;
}

/**
 * Which club the user is currently operating.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THIS IS NOT A SECURITY BOUNDARY.
 * ─────────────────────────────────────────────────────────────────────────
 * It decides what the app *shows*, never what the database *allows*. Anyone can
 * put any uuid in here; Row Level Security is what makes that useless, because
 * every policy asks whether the caller holds a membership in the tenant a row
 * belongs to, not what the client claims to be looking at.
 *
 * Persisted so that reopening the app returns to the club you were working in
 * rather than asking again mid-shift. The stored id is always re-validated
 * against live memberships before it is honoured (see `useAppSession`): a club
 * you have been removed from, or that has been suspended, is discarded.
 */
export const useActiveClubStore = create<ActiveClubState>((set) => ({
  tenantId: null,
  hydrated: false,

  async hydrate() {
    try {
      const stored = await sessionStorage.getItem(STORAGE_KEY);
      set({ tenantId: stored, hydrated: true });
      if (stored) log.debug('Restored active club', { tenantId: stored });
    } catch (error) {
      // A failure to read the last club is not worth blocking sign-in over;
      // the user simply gets the selector again.
      log.warn('Could not restore the active club', { error: String(error) });
      set({ tenantId: null, hydrated: true });
    }
  },

  select(tenantId) {
    set({ tenantId, hydrated: true });
    void sessionStorage.setItem(STORAGE_KEY, tenantId).catch((error: unknown) => {
      log.warn('Could not persist the active club', { error: String(error) });
    });
  },

  clear() {
    set({ tenantId: null, hydrated: true });
    void sessionStorage.removeItem(STORAGE_KEY).catch(() => undefined);
  },
}));

export const activeClubStorageKey = STORAGE_KEY;
