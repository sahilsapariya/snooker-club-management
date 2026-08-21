import { QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useMemo, type ReactNode } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ToastProvider } from '@/components/ui';
import { useAppSession, useAuthListener } from '@/features/auth';
import { createQueryClient } from '@/lib/query';
import { startSupabaseAutoRefresh } from '@/lib/supabase';
import { brandingFromTenant, ThemeProvider, type Branding } from '@/theme';

/**
 * Root providers, in dependency order.
 *
 *   SafeAreaProvider          layout metrics
 *     QueryClientProvider     server state (the auth listener needs it)
 *       ThemedApp             resolves the club, then themes the tree
 *
 * The theme sits inside the query provider because a club's branding is server
 * state: the app boots with the product's default palette and re-themes once
 * the tenant row has been read.
 */
export function AppProviders({ children }: { readonly children: ReactNode }) {
  const queryClient = useMemo(() => createQueryClient(), []);

  useEffect(() => startSupabaseAutoRefresh(), []);

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <ThemedApp>{children}</ThemedApp>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

function ThemedApp({ children }: { readonly children: ReactNode }) {
  useAuthListener();
  const session = useAppSession();

  const branding: Branding | null = useMemo(() => {
    if (session.status === 'tenant-user' || session.status === 'tenant-suspended') {
      return brandingFromTenant(session.tenant);
    }
    return null;
  }, [session]);

  return (
    <ThemeProvider branding={branding}>
      <StatusBar style="auto" />
      {/* Inside the theme because toasts read semantic colour tokens, and
          above the router so any screen can raise one. */}
      <ToastProvider>{children}</ToastProvider>
    </ThemeProvider>
  );
}
