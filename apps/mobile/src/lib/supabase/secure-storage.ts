import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { logger } from '@/lib/logger';

const log = logger.child('secure-storage');

/**
 * iOS Keychain and Android EncryptedSharedPreferences reject values beyond
 * roughly 2 KB. A Supabase session (access token + refresh token + user object)
 * routinely exceeds that, so values are split across several entries.
 *
 * Below the limit, with headroom for the key name and encoding overhead.
 */
const CHUNK_SIZE = 1536;

/** Marks a manifest entry. Chosen so it cannot collide with a JWT or JSON. */
const MANIFEST_PREFIX = ' chunked:';

export interface SessionStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

function chunkKey(key: string, index: number): string {
  return `${key}.${index}`;
}

function splitIntoChunks(value: string): string[] {
  const chunks: string[] = [];
  for (let offset = 0; offset < value.length; offset += CHUNK_SIZE) {
    chunks.push(value.slice(offset, offset + CHUNK_SIZE));
  }
  return chunks.length > 0 ? chunks : [''];
}

function parseManifest(raw: string): number | null {
  if (!raw.startsWith(MANIFEST_PREFIX)) return null;
  const count = Number.parseInt(raw.slice(MANIFEST_PREFIX.length), 10);
  return Number.isInteger(count) && count > 0 ? count : null;
}

async function removeChunks(key: string, from: number, to: number): Promise<void> {
  if (to <= from) return;
  await Promise.all(
    Array.from({ length: to - from }, (_unused, offset) =>
      SecureStore.deleteItemAsync(chunkKey(key, from + offset)),
    ),
  );
}

/**
 * Chunking adapter over expo-secure-store.
 *
 * A single logical key is stored either directly (small values) or as a
 * manifest plus N chunk entries. Reads understand both shapes, and a write
 * always cleans up chunks left behind by a longer previous value.
 */
export const secureSessionStorage: SessionStorage = {
  async getItem(key) {
    try {
      const head = await SecureStore.getItemAsync(key);
      if (head === null) return null;

      const chunkCount = parseManifest(head);
      if (chunkCount === null) return head;

      const parts = await Promise.all(
        Array.from({ length: chunkCount }, (_unused, index) =>
          SecureStore.getItemAsync(chunkKey(key, index)),
        ),
      );

      if (parts.some((part) => part === null)) {
        // A partially written or partially evicted value is not recoverable.
        // Treating it as absent makes the app fall back to signed-out rather
        // than repeatedly failing to parse a truncated session.
        log.warn('Discarding an incomplete chunked value', { key });
        await secureSessionStorage.removeItem(key);
        return null;
      }

      return parts.join('');
    } catch (error) {
      log.error('Failed to read from secure storage', error, { key });
      return null;
    }
  },

  async setItem(key, value) {
    try {
      const previous = await SecureStore.getItemAsync(key);
      const previousChunkCount = previous === null ? 0 : (parseManifest(previous) ?? 0);

      if (value.length <= CHUNK_SIZE) {
        await SecureStore.setItemAsync(key, value);
        await removeChunks(key, 0, previousChunkCount);
        return;
      }

      const chunks = splitIntoChunks(value);
      await Promise.all(
        chunks.map((chunk, index) => SecureStore.setItemAsync(chunkKey(key, index), chunk)),
      );
      await SecureStore.setItemAsync(key, `${MANIFEST_PREFIX}${chunks.length}`);
      await removeChunks(key, chunks.length, previousChunkCount);
    } catch (error) {
      log.error('Failed to write to secure storage', error, { key });
      throw error;
    }
  },

  async removeItem(key) {
    try {
      const head = await SecureStore.getItemAsync(key);
      const chunkCount = head === null ? 0 : (parseManifest(head) ?? 0);
      await removeChunks(key, 0, chunkCount);
      await SecureStore.deleteItemAsync(key);
    } catch (error) {
      log.error('Failed to clear secure storage', error, { key });
    }
  },
};

/**
 * Web has no Keychain. Sessions fall back to localStorage there, which is only
 * used for local development in a browser; shipped builds are native.
 */
const webStorage: SessionStorage = {
  async getItem(key) {
    return globalThis.localStorage?.getItem(key) ?? null;
  },
  async setItem(key, value) {
    globalThis.localStorage?.setItem(key, value);
  },
  async removeItem(key) {
    globalThis.localStorage?.removeItem(key);
  },
};

export const sessionStorage: SessionStorage =
  Platform.OS === 'web' ? webStorage : secureSessionStorage;

export const __testing = { CHUNK_SIZE, MANIFEST_PREFIX };
