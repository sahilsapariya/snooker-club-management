import { QueryClient } from '@tanstack/react-query';

import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';

const log = logger.child('query');

/**
 * Server state lives here and only here.
 *
 * Zustand holds auth and UI state; anything that came from Postgres is cached
 * by TanStack Query so there is exactly one copy, one staleness policy and one
 * invalidation story.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // A club's tables and prices change rarely; a minute of staleness is
        // invisible to staff and removes a lot of redundant traffic on a
        // phone that may be on mobile data.
        staleTime: 60_000,
        gcTime: 5 * 60_000,
        retry: (failureCount, error) => {
          // Retrying a permission or validation failure just repeats it.
          if (error instanceof AppError && !error.retryable) return false;
          return failureCount < 2;
        },
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
        refetchOnWindowFocus: false,
        refetchOnReconnect: true,
      },
      mutations: {
        retry: false,
        onError: (error) => {
          const appError = error instanceof AppError ? error : null;
          log.error('Mutation failed', error, {
            code: appError?.code,
            technical: appError?.technicalMessage,
          });
        },
      },
    },
  });
}
