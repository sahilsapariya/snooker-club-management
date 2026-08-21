import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, act, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { queryKeys } from '@/lib/query';
import { useActiveClubStore } from '@/stores/active-club.store';

import { useClearActiveClub, useSwitchClub } from './use-active-club';

/**
 * Cache isolation across a club switch.
 *
 * This is the failure mode that would quietly destroy trust in the app: an
 * owner switches from one club to another and, for a moment, sees the previous
 * club's takings under the new club's name and colours. Nobody would report it
 * as a bug - they would simply stop believing the numbers.
 *
 * Two separate mechanisms prevent it, and both are tested here:
 *
 *   Structure   every club-scoped key starts ['tenant', tenantId, …], so two
 *               clubs' data physically cannot share a cache entry.
 *   Eviction    the outgoing club's entries are removed, not invalidated - an
 *               invalidated entry is still served while it refetches, which is
 *               exactly the flash being prevented.
 */

const CLUB_A = 'aaaaaaaa-0000-4000-8000-000000000001';
const CLUB_B = 'cccccccc-0000-4000-8000-000000000003';

function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
}

function wrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

/** Fills the cache with data for both clubs, as a mid-shift app would have. */
function seedBothClubs(client: QueryClient): void {
  client.setQueryData(queryKeys.sessions.open(CLUB_A), [{ id: 'session-a' }]);
  client.setQueryData(queryKeys.tables.overview(CLUB_A), [{ id: 'table-a' }]);
  client.setQueryData(queryKeys.billing.settings(CLUB_A), { grace_period_minutes: 5 });
  client.setQueryData(queryKeys.sessions.open(CLUB_B), [{ id: 'session-b' }]);
  client.setQueryData(queryKeys.tables.overview(CLUB_B), [{ id: 'table-b' }]);
}

beforeEach(() => {
  useActiveClubStore.setState({ tenantId: CLUB_A, hydrated: true });
});

describe('switching club', () => {
  it('evicts the club being left and keeps the one being entered', async () => {
    const client = makeClient();
    seedBothClubs(client);

    const { result } = renderHook(() => useSwitchClub(), { wrapper: wrapper(client) });
    await act(async () => {
      await result.current(CLUB_B);
    });

    expect(client.getQueryData(queryKeys.sessions.open(CLUB_A))).toBeUndefined();
    expect(client.getQueryData(queryKeys.tables.overview(CLUB_A))).toBeUndefined();
    expect(client.getQueryData(queryKeys.billing.settings(CLUB_A))).toBeUndefined();

    // The incoming club's entries survive - they are only marked stale.
    expect(client.getQueryData(queryKeys.sessions.open(CLUB_B))).toEqual([{ id: 'session-b' }]);
  });

  it('records the new club so a relaunch returns to it', async () => {
    const client = makeClient();
    const { result } = renderHook(() => useSwitchClub(), { wrapper: wrapper(client) });

    await act(async () => {
      await result.current(CLUB_B);
    });

    await waitFor(() => expect(useActiveClubStore.getState().tenantId).toBe(CLUB_B));
  });

  it('marks the club being entered as stale so it refetches', async () => {
    const client = makeClient();
    seedBothClubs(client);

    const { result } = renderHook(() => useSwitchClub(), { wrapper: wrapper(client) });
    await act(async () => {
      await result.current(CLUB_B);
    });

    const entry = client.getQueryCache().find({ queryKey: queryKeys.sessions.open(CLUB_B) });
    expect(entry?.state.isInvalidated).toBe(true);
  });

  it('does nothing when the chosen club is already active', async () => {
    const client = makeClient();
    seedBothClubs(client);

    const { result } = renderHook(() => useSwitchClub(), { wrapper: wrapper(client) });
    await act(async () => {
      await result.current(CLUB_A);
    });

    // Not a no-op by accident: re-selecting must not throw away the data the
    // user is currently looking at.
    expect(client.getQueryData(queryKeys.sessions.open(CLUB_A))).toEqual([{ id: 'session-a' }]);
  });

  it('drops every club when the active club is cleared', async () => {
    const client = makeClient();
    seedBothClubs(client);

    const { result } = renderHook(() => useClearActiveClub(), { wrapper: wrapper(client) });
    act(() => {
      result.current();
    });

    // Returning to the selector must not leave either club resident: the next
    // choice might be made by a different person at the same counter.
    expect(client.getQueryData(queryKeys.sessions.open(CLUB_A))).toBeUndefined();
    expect(client.getQueryData(queryKeys.sessions.open(CLUB_B))).toBeUndefined();
    await waitFor(() => expect(useActiveClubStore.getState().tenantId).toBeNull());
  });

  it('leaves platform-scoped data alone, because it is not club data', async () => {
    const client = makeClient();
    seedBothClubs(client);
    client.setQueryData(queryKeys.platform.owners(), [{ user_id: 'owner-1' }]);

    const { result } = renderHook(() => useClearActiveClub(), { wrapper: wrapper(client) });
    act(() => {
      result.current();
    });

    expect(client.getQueryData(queryKeys.platform.owners())).toEqual([{ user_id: 'owner-1' }]);
  });
});
