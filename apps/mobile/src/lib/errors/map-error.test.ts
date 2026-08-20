import type { PostgrestError } from '@supabase/supabase-js';

import { AppError } from './app-error';
import { toAppError, unwrap } from './map-error';

/**
 * The contract these tests defend: a raw database message never reaches a
 * screen. "new row violates row-level security policy for table \"sessions\""
 * tells an attacker about the schema and tells a receptionist nothing.
 */

const postgrestError = (code: string, message: string): PostgrestError => ({
  code,
  message,
  details: '',
  hint: '',
  name: 'PostgrestError',
  toJSON: () => ({ code, message, details: '', hint: '', name: 'PostgrestError' }),
});

describe('toAppError', () => {
  it('turns an RLS refusal into a permission message without leaking the table name', () => {
    const error = toAppError(
      postgrestError('42501', 'new row violates row-level security policy for table "sessions"'),
    );

    expect(error.code).toBe('permission-denied');
    expect(error.userMessage).toBe("You don't have permission to do that.");
    expect(error.userMessage).not.toMatch(/row-level|sessions|policy/i);
    // The detail is still available to the logs.
    expect(error.technicalMessage).toContain('row-level security');
  });

  it('maps the constraint violations this schema actually raises', () => {
    expect(toAppError(postgrestError('23505', 'duplicate key')).code).toBe('conflict');
    expect(toAppError(postgrestError('23503', 'fk violation')).code).toBe('validation');
    expect(toAppError(postgrestError('23514', 'check violation')).code).toBe('validation');
    expect(toAppError(postgrestError('PGRST116', 'no rows')).code).toBe('not-found');
  });

  it('explains a write to a generated column in terms a user understands', () => {
    const error = toAppError(
      postgrestError('428C9', 'column "actual_duration_seconds" can only be updated to DEFAULT'),
    );

    expect(error.code).toBe('validation');
    expect(error.userMessage).toBe(
      'That value is calculated automatically and cannot be set directly.',
    );
  });

  it('recognises a dropped connection and marks it retryable', () => {
    const error = toAppError(new TypeError('Network request failed'));

    expect(error.code).toBe('network');
    expect(error.retryable).toBe(true);
    expect(error.userMessage).toMatch(/connection/i);
  });

  it('recognises auth failures by message', () => {
    const authError = Object.assign(new Error('Invalid login credentials'), {
      name: 'AuthApiError',
    });

    const error = toAppError(authError);
    expect(error.code).toBe('auth/invalid-credentials');
    expect(error.userMessage).toBe('That email or password is incorrect.');
    expect(error.retryable).toBe(false);
  });

  it('marks an expired session so the app can send the user back to login', () => {
    const authError = Object.assign(new Error('JWT expired'), { name: 'AuthApiError' });
    expect(toAppError(authError).code).toBe('auth/session-expired');
  });

  it('passes an AppError through unchanged', () => {
    const original = new AppError({ code: 'config', message: 'Bad config' });
    expect(toAppError(original)).toBe(original);
  });

  it('falls back safely for something entirely unexpected', () => {
    const error = toAppError({ weird: true });
    expect(error.code).toBe('unknown');
    expect(error.userMessage).toBe('Something went wrong. Please try again.');
  });
});

describe('unwrap', () => {
  it('returns the data when the call succeeded', () => {
    expect(unwrap({ data: [1, 2, 3], error: null }, 'load things')).toEqual([1, 2, 3]);
  });

  it('throws a mapped AppError when the call failed', () => {
    expect(() =>
      unwrap({ data: null, error: postgrestError('42501', 'denied') }, 'load things'),
    ).toThrow(AppError);

    try {
      unwrap({ data: null, error: postgrestError('42501', 'denied') }, 'load things');
    } catch (error) {
      expect((error as AppError).code).toBe('permission-denied');
    }
  });
});
