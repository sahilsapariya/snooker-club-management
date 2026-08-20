import { Redirect, Stack } from 'expo-router';

import { useAppSession } from '@/features/auth';

/**
 * Signed-out routes.
 *
 * Bounces an already-authenticated user back to the gate so the login screen
 * cannot be reached with a live session (e.g. via a deep link).
 */
export default function AuthLayout() {
  const session = useAppSession();

  if (session.status !== 'loading' && session.status !== 'unauthenticated') {
    return <Redirect href="/" />;
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}
