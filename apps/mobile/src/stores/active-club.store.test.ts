import { waitFor } from '@testing-library/react-native';

import { activeClubStorageKey, useActiveClubStore } from './active-club.store';

/**
 * Remembering which club someone was working in.
 *
 * The value of getting this right is small and the cost of getting it wrong is
 * large: an owner reopening the app mid-shift should land back where they were,
 * but a storage failure must never block sign-in — the worst acceptable outcome
 * is being asked to choose again.
 */

const secureStore = jest.requireMock('expo-secure-store') as {
  getItemAsync: jest.Mock;
  setItemAsync: jest.Mock;
  deleteItemAsync: jest.Mock;
  __store: Map<string, string>;
};

const CLUB = 'cccccccc-0000-4000-8000-000000000003';

beforeEach(() => {
  secureStore.__store.clear();
  useActiveClubStore.setState({ tenantId: null, hydrated: false });
});

describe('the active club store', () => {
  it('starts empty and unhydrated, so the app waits rather than guessing', () => {
    const state = useActiveClubStore.getState();
    expect(state.tenantId).toBeNull();
    expect(state.hydrated).toBe(false);
  });

  it('restores the last club on hydrate', async () => {
    secureStore.__store.set(activeClubStorageKey, CLUB);

    await useActiveClubStore.getState().hydrate();

    expect(useActiveClubStore.getState().tenantId).toBe(CLUB);
    expect(useActiveClubStore.getState().hydrated).toBe(true);
  });

  it('hydrates to empty when nothing was stored', async () => {
    await useActiveClubStore.getState().hydrate();

    expect(useActiveClubStore.getState().tenantId).toBeNull();
    expect(useActiveClubStore.getState().hydrated).toBe(true);
  });

  it('still finishes hydrating when storage throws', async () => {
    secureStore.getItemAsync.mockRejectedValueOnce(new Error('keychain unavailable'));

    await useActiveClubStore.getState().hydrate();

    // Hydrated, just with nothing — the selector appears instead of the app
    // hanging on a loading state forever.
    expect(useActiveClubStore.getState().hydrated).toBe(true);
    expect(useActiveClubStore.getState().tenantId).toBeNull();
  });

  it('persists a selection', async () => {
    useActiveClubStore.getState().select(CLUB);

    expect(useActiveClubStore.getState().tenantId).toBe(CLUB);
    // Written through the chunking adapter, so assert on what a later hydrate
    // would actually read rather than on how it got there.
    await waitFor(() => expect(secureStore.__store.get(activeClubStorageKey)).toBe(CLUB));
  });

  it('keeps working when the selection cannot be persisted', async () => {
    secureStore.setItemAsync.mockRejectedValueOnce(new Error('disk full'));

    expect(() => useActiveClubStore.getState().select(CLUB)).not.toThrow();
    // The switch itself succeeded; only the memory of it was lost.
    expect(useActiveClubStore.getState().tenantId).toBe(CLUB);
  });

  it('forgets the club on clear', async () => {
    useActiveClubStore.getState().select(CLUB);
    await waitFor(() => expect(secureStore.__store.has(activeClubStorageKey)).toBe(true));

    useActiveClubStore.getState().clear();

    expect(useActiveClubStore.getState().tenantId).toBeNull();
    await waitFor(() => expect(secureStore.__store.has(activeClubStorageKey)).toBe(false));
  });
});
