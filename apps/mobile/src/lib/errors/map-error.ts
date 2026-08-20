import type { AuthError, PostgrestError } from '@supabase/supabase-js';

import { logger } from '@/lib/logger';

import { AppError, isAppError, type AppErrorCode } from './app-error';

const log = logger.child('errors');

/**
 * Postgres / PostgREST condition -> what the user is told.
 *
 * The SQLSTATEs here are the ones this schema can actually raise, and each maps
 * to a sentence a receptionist can act on.
 */
const POSTGRES_CODE_MAP: Record<string, { code: AppErrorCode; message: string }> = {
  // insufficient_privilege - RLS refused the row, or the grant is absent.
  '42501': {
    code: 'permission-denied',
    message: "You don't have permission to do that.",
  },
  // unique_violation
  '23505': {
    code: 'conflict',
    message: 'That already exists. Check for a duplicate and try again.',
  },
  // foreign_key_violation
  '23503': {
    code: 'validation',
    message: 'Something this refers to is missing or belongs to another club.',
  },
  // check_violation - our business rules speak through these.
  '23514': {
    code: 'validation',
    message: "That change isn't allowed by this club's rules.",
  },
  // not_null_violation
  '23502': { code: 'validation', message: 'A required field is missing.' },
  // generated_always - e.g. trying to write actual_duration_seconds.
  '428C9': {
    code: 'validation',
    message: 'That value is calculated automatically and cannot be set directly.',
  },
  // PostgREST: no rows when exactly one was expected.
  PGRST116: { code: 'not-found', message: "We couldn't find that." },
  // PostgREST: JWT rejected.
  PGRST301: {
    code: 'auth/session-expired',
    message: 'Your session has expired. Please sign in again.',
  },
  // raise_exception from a trigger guard.
  P0001: { code: 'validation', message: "That change isn't allowed." },
  // no_data_found
  P0002: { code: 'not-found', message: "We couldn't find that." },
};

const AUTH_MESSAGE_MAP: readonly {
  match: RegExp;
  code: AppErrorCode;
  message: string;
}[] = [
  {
    match: /invalid login credentials/i,
    code: 'auth/invalid-credentials',
    message: 'That email or password is incorrect.',
  },
  {
    match: /email not confirmed/i,
    code: 'auth/email-not-confirmed',
    message: 'This account still needs to confirm its email address.',
  },
  {
    match: /(rate limit|too many requests)/i,
    code: 'auth/rate-limited',
    message: 'Too many attempts. Please wait a minute and try again.',
  },
  {
    match: /(refresh token|jwt expired|session.*expired|invalid claim)/i,
    code: 'auth/session-expired',
    message: 'Your session has expired. Please sign in again.',
  },
  {
    match: /(user is banned|user not found|signups not allowed)/i,
    code: 'auth/account-disabled',
    message: 'This account is not able to sign in. Contact your club owner.',
  },
];

function isPostgrestError(value: unknown): value is PostgrestError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'message' in value &&
    'code' in value &&
    'details' in value
  );
}

function isAuthError(value: unknown): value is AuthError {
  return value instanceof Error && value.name.startsWith('Auth');
}

function looksLikeNetworkFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /network request failed|fetch failed|failed to fetch|network error|econnrefused/i.test(
    error.message,
  );
}

/**
 * Normalises anything thrown by Supabase, the network layer or our own code
 * into an `AppError`. Callers render `error.userMessage`; the original text is
 * kept on `technicalMessage` for the logs.
 */
export function toAppError(error: unknown, fallbackMessage?: string): AppError {
  if (isAppError(error)) return error;

  if (looksLikeNetworkFailure(error)) {
    return new AppError({
      code: 'network',
      message: "Can't reach the server. Check your connection and try again.",
      technicalMessage: error instanceof Error ? error.message : String(error),
      cause: error,
    });
  }

  if (isAuthError(error)) {
    const matched = AUTH_MESSAGE_MAP.find((entry) => entry.match.test(error.message));
    return new AppError({
      code: matched?.code ?? 'unknown',
      message: matched?.message ?? fallbackMessage ?? 'Sign-in failed. Please try again.',
      technicalMessage: error.message,
      cause: error,
    });
  }

  if (isPostgrestError(error)) {
    const mapped = POSTGRES_CODE_MAP[error.code];
    if (mapped) {
      return new AppError({
        code: mapped.code,
        message: mapped.message,
        technicalMessage: `${error.code}: ${error.message}`,
        cause: error,
        details: { hint: error.hint, details: error.details },
      });
    }
    log.warn('Unmapped Postgres error code', { code: error.code, message: error.message });
    return new AppError({
      code: 'unknown',
      message: fallbackMessage ?? 'Something went wrong. Please try again.',
      technicalMessage: `${error.code}: ${error.message}`,
      cause: error,
    });
  }

  return new AppError({
    code: 'unknown',
    message: fallbackMessage ?? 'Something went wrong. Please try again.',
    technicalMessage: error instanceof Error ? error.message : String(error),
    cause: error,
  });
}

/**
 * Unwraps a Supabase `{ data, error }` result, converting a failure into an
 * `AppError` and logging the technical detail. Every data-access function in
 * `features/*&#47;api` funnels through this.
 */
export function unwrap<T>(
  result: { data: T; error: null } | { data: null; error: PostgrestError },
  context: string,
): T {
  if (result.error) {
    const appError = toAppError(result.error);
    log.error(`${context} failed`, appError, { technical: appError.technicalMessage });
    throw appError;
  }
  return result.data;
}
