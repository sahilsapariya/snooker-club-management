// Supabase's auth and realtime clients build URLs with the WHATWG `URL` API,
// which React Native only partially implements. Must be imported before the
// client is created.
import 'react-native-url-polyfill/auto';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AppState, type AppStateStatus } from 'react-native';

import { env } from '@/constants/env';
import { logger } from '@/lib/logger';
import type { Database } from '@/types/database.types';

import { sessionStorage } from './secure-storage';

const log = logger.child('supabase');

/**
 * The one Supabase client for the app.
 *
 * It is created with the ANON key only. That key is public by design and grants
 * nothing on its own: `anon` holds no privilege on any table in this schema
 * (migration 0011), and every authenticated request is filtered by Row Level
 * Security. The service role key never appears in this codebase.
 */
export const supabase: SupabaseClient<Database> = createClient<Database>(
  env.supabaseUrl,
  env.supabaseAnonKey,
  {
    auth: {
      storage: sessionStorage,
      autoRefreshToken: true,
      persistSession: true,
      // There is no browser URL to read a session out of on a native client,
      // and leaving it on makes the SDK poke at `window.location`.
      detectSessionInUrl: false,
      flowType: 'pkce',
    },
    global: {
      headers: { 'x-client-info': 'clubdesk-mobile' },
    },
    db: { schema: 'public' },
  },
);

/**
 * Supabase refreshes tokens on a timer, which the OS suspends in the
 * background. Tying the timer to foreground state means a receptionist who
 * leaves the app open all evening comes back to a valid session instead of a
 * silent 401.
 */
function handleAppStateChange(state: AppStateStatus): void {
  if (state === 'active') {
    void supabase.auth.startAutoRefresh();
  } else {
    void supabase.auth.stopAutoRefresh();
  }
}

let appStateSubscription: { remove(): void } | null = null;

export function startSupabaseAutoRefresh(): () => void {
  if (appStateSubscription) return () => undefined;

  appStateSubscription = AppState.addEventListener('change', handleAppStateChange);
  if (AppState.currentState === 'active') {
    void supabase.auth.startAutoRefresh();
  }
  log.debug('Auth auto-refresh bound to app state');

  return () => {
    appStateSubscription?.remove();
    appStateSubscription = null;
    void supabase.auth.stopAutoRefresh();
  };
}
