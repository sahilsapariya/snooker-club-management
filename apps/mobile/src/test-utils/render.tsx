import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderOptions } from '@testing-library/react-native';
import type { ReactElement, ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ToastProvider } from '@/components/ui';
import { ThemeProvider, type Branding, type ColorScheme } from '@/theme';

/**
 * Renders a component inside the providers the real app supplies.
 *
 * Components read theme tokens through context, so rendering one bare tells you
 * nothing useful. Passing `branding` here is also how a test asserts that a
 * screen is genuinely brand-agnostic.
 */
export interface RenderWithProvidersOptions extends Omit<RenderOptions, 'wrapper'> {
  readonly branding?: Branding;
  readonly scheme?: ColorScheme;
}

export function renderWithProviders(ui: ReactElement, options: RenderWithProvidersOptions = {}) {
  const { branding, scheme, ...renderOptions } = options;

  const queryClient = new QueryClient({
    defaultOptions: {
      // Retries turn a deliberate failure into a slow test.
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });

  function Wrapper({ children }: { readonly children: ReactNode }) {
    return (
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 390, height: 844 },
          insets: { top: 47, left: 0, right: 0, bottom: 34 },
        }}
      >
        <QueryClientProvider client={queryClient}>
          <ThemeProvider branding={branding ?? null} {...(scheme === undefined ? {} : { scheme })}>
            <ToastProvider>{children}</ToastProvider>
          </ThemeProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    );
  }

  return { ...render(ui, { wrapper: Wrapper, ...renderOptions }), queryClient };
}
