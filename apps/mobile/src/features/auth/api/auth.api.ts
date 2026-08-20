import type { Session } from '@supabase/supabase-js';

import { AppError, toAppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { supabase } from '@/lib/supabase';

const log = logger.child('auth');

/**
 * Every call into Supabase Auth goes through this module.
 *
 * Screens never import `supabase.auth` directly, so error translation, logging
 * and the sign-out cleanup path all exist in exactly one place.
 */

export interface SignInCredentials {
  readonly email: string;
  readonly password: string;
}

export async function signInWithPassword({ email, password }: SignInCredentials): Promise<Session> {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  });

  if (error) {
    const appError = toAppError(error, 'Sign-in failed. Please try again.');
    log.warn('Sign-in rejected', { code: appError.code });
    throw appError;
  }

  if (!data.session) {
    throw new AppError({
      code: 'auth/invalid-credentials',
      message: 'Sign-in did not complete. Please try again.',
      technicalMessage: 'signInWithPassword returned no session',
    });
  }

  log.info('Signed in');
  return data.session;
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error) {
    // A failed sign-out still has to clear local state, so this is logged
    // rather than thrown: the stored session is dropped either way.
    log.warn('Sign-out returned an error', { message: error.message });
  }
  log.info('Signed out');
}

export async function getCurrentSession(): Promise<Session | null> {
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    log.warn('Could not read the stored session', { message: error.message });
    return null;
  }
  return data.session;
}

export async function sendPasswordReset(email: string): Promise<void> {
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase());
  if (error) throw toAppError(error, 'Could not send the reset email.');
}
