import * as SecureStore from 'expo-secure-store';

import { __testing, secureSessionStorage } from './secure-storage';

/**
 * Supabase sessions are routinely larger than the ~2 KB an entry in the iOS
 * Keychain or Android EncryptedSharedPreferences will hold. If chunking is
 * wrong, sign-in appears to work and then the session silently fails to
 * restore, which is a miserable bug to chase. Hence these tests.
 */

type MockedStore = { __store: Map<string, string> };
const store = (SecureStore as unknown as MockedStore).__store;

beforeEach(() => {
  store.clear();
});

const KEY = 'sb-localhost-auth-token';

describe('secureSessionStorage', () => {
  it('stores a small value in a single entry', async () => {
    await secureSessionStorage.setItem(KEY, 'small-value');

    expect(await secureSessionStorage.getItem(KEY)).toBe('small-value');
    expect([...store.keys()]).toEqual([KEY]);
  });

  it('splits a value larger than the chunk size and reassembles it exactly', async () => {
    const value = 'x'.repeat(__testing.CHUNK_SIZE * 3 + 17);

    await secureSessionStorage.setItem(KEY, value);

    // Manifest plus four chunks.
    expect(store.size).toBe(5);
    expect(store.get(KEY)).toBe(`${__testing.MANIFEST_PREFIX}4`);
    for (const chunk of [...store.entries()].filter(([key]) => key !== KEY)) {
      expect(chunk[1].length).toBeLessThanOrEqual(__testing.CHUNK_SIZE);
    }

    expect(await secureSessionStorage.getItem(KEY)).toBe(value);
  });

  it('round-trips a realistically sized Supabase session', async () => {
    const session = JSON.stringify({
      access_token: 'a'.repeat(900),
      refresh_token: 'r'.repeat(64),
      expires_at: 1_800_000_000,
      user: { id: 'uuid', email: 'owner@royalsnooker.dev', app_metadata: { x: 'y'.repeat(1500) } },
    });

    await secureSessionStorage.setItem(KEY, session);
    expect(await secureSessionStorage.getItem(KEY)).toBe(session);
    expect(JSON.parse((await secureSessionStorage.getItem(KEY)) ?? '{}')).toMatchObject({
      refresh_token: 'r'.repeat(64),
    });
  });

  it('cleans up leftover chunks when a shorter value replaces a longer one', async () => {
    await secureSessionStorage.setItem(KEY, 'y'.repeat(__testing.CHUNK_SIZE * 4));
    expect(store.size).toBe(5);

    await secureSessionStorage.setItem(KEY, 'tiny');

    expect(store.size).toBe(1);
    expect(await secureSessionStorage.getItem(KEY)).toBe('tiny');
  });

  it('shrinks the chunk count when the new value needs fewer chunks', async () => {
    await secureSessionStorage.setItem(KEY, 'y'.repeat(__testing.CHUNK_SIZE * 4));
    const longer = 'z'.repeat(__testing.CHUNK_SIZE * 2);

    await secureSessionStorage.setItem(KEY, longer);

    expect(store.get(KEY)).toBe(`${__testing.MANIFEST_PREFIX}2`);
    expect(store.size).toBe(3);
    expect(await secureSessionStorage.getItem(KEY)).toBe(longer);
  });

  it('removes every chunk on delete', async () => {
    await secureSessionStorage.setItem(KEY, 'q'.repeat(__testing.CHUNK_SIZE * 3));

    await secureSessionStorage.removeItem(KEY);

    expect(store.size).toBe(0);
    expect(await secureSessionStorage.getItem(KEY)).toBeNull();
  });

  it('treats a partially written value as absent rather than returning a truncated session', async () => {
    await secureSessionStorage.setItem(KEY, 'w'.repeat(__testing.CHUNK_SIZE * 3));
    store.delete(`${KEY}.1`);

    expect(await secureSessionStorage.getItem(KEY)).toBeNull();
    // And the wreckage is cleared so the next write starts clean.
    expect(store.size).toBe(0);
  });

  it('returns null for a key that was never written', async () => {
    expect(await secureSessionStorage.getItem('nothing-here')).toBeNull();
  });
});
