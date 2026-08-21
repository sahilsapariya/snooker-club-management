import { Redirect } from 'expo-router';
import { LogOut } from 'lucide-react-native';
import { View } from 'react-native';

import { Button, EmptyState, ErrorState, LoadingState, Screen, Text } from '@/components/ui';
import { useAppSession, useRefreshSessionContext, useSignOut } from '@/features/auth';
import { useTheme } from '@/theme';

/**
 * The gate.
 *
 * Every launch lands here, and this is the one place that decides which shell
 * the user gets. Doing it in a single component means the "what if the account
 * is disabled" and "what if the club is suspended" branches cannot be
 * accidentally omitted by a new screen.
 *
 * This is routing, not authorization: the database refuses the data regardless
 * of which screen someone reaches.
 */
export default function IndexRoute() {
  const session = useAppSession();
  const refresh = useRefreshSessionContext();

  switch (session.status) {
    case 'loading':
      return (
        <Screen>
          <LoadingState label="Signing you in" />
        </Screen>
      );

    case 'unauthenticated':
      return <Redirect href="/(auth)/login" />;

    case 'platform-admin':
      return <Redirect href="/(platform)" />;

    case 'tenant-user':
      return <Redirect href="/(tenant)/tables" />;

    // Several clubs and none chosen yet. Deliberately a route rather than an
    // inline branch, so "switch club" can send an owner back to it.
    case 'club-selection':
      return <Redirect href="/select-club" />;

    case 'error':
      return (
        <Screen>
          <ErrorState error={session.error} onRetry={() => void refresh()} />
        </Screen>
      );

    case 'account-disabled':
      return (
        <BlockedScreen
          title="This account is disabled"
          description={`${session.profile.email} can no longer sign in. Ask your club owner or the platform administrator to re-enable it.`}
        />
      );

    case 'no-tenant':
      return (
        <BlockedScreen
          title="No club assigned yet"
          description={`${session.profile.email} is signed in but is not linked to a club. Ask the platform administrator to add you to one.`}
        />
      );

    case 'tenant-suspended':
      return (
        <BlockedScreen
          title={`${session.tenant.name} is not active`}
          description="This club's account has been suspended. Contact the platform administrator to restore access."
        />
      );
  }
}

function BlockedScreen({
  title,
  description,
}: {
  readonly title: string;
  readonly description: string;
}) {
  const theme = useTheme();
  const signOut = useSignOut();

  return (
    <Screen>
      <View style={{ flex: 1, justifyContent: 'center', gap: theme.spacing.xl }}>
        <EmptyState title={title} description={description} />
        <Button
          label="Sign out"
          variant="outline"
          icon={LogOut}
          onPress={() => void signOut()}
          fullWidth
        />
        <Text variant="caption" color="textMuted" align="center">
          Club Desk
        </Text>
      </View>
    </Screen>
  );
}
