import { Redirect, Stack } from 'expo-router';

import { LoadingState, Screen } from '@/components/ui';
import { useAppSession } from '@/features/auth';
import { useTheme } from '@/theme';

/**
 * Platform administration shell.
 *
 * Kept as a separate route group so club staff never navigate into it. That
 * separation is for clarity, not for safety: `public.tenants` has its write
 * privileges revoked from the `authenticated` role entirely, and the platform
 * RPCs re-check `app.is_platform_admin()` inside the database. A club user who
 * somehow reached these screens would simply be refused by Postgres.
 *
 * The stack is ordered by the product's hierarchy - platform, then owners, then
 * clubs - because that is the direction administration actually flows: the
 * platform signs up an owner, and the owner is given clubs.
 */
export default function PlatformLayout() {
  const theme = useTheme();
  const session = useAppSession();

  if (session.status === 'loading') {
    return (
      <Screen>
        <LoadingState />
      </Screen>
    );
  }

  if (session.status !== 'platform-admin') {
    return <Redirect href="/" />;
  }

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: theme.colors.surface },
        headerTintColor: theme.colors.textPrimary,
        headerTitleStyle: theme.typography.titleMd,
        contentStyle: { backgroundColor: theme.colors.background },
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Platform' }} />
      <Stack.Screen name="owners" options={{ title: 'Owners' }} />
      <Stack.Screen name="owner/[id]" options={{ title: 'Owner' }} />
      <Stack.Screen name="tenants" options={{ title: 'Clubs' }} />
      <Stack.Screen name="tenant/[id]" options={{ title: 'Club' }} />
      <Stack.Screen name="club-new" options={{ title: 'New club' }} />
    </Stack>
  );
}
