import { View } from 'react-native';

import { Screen, Text } from '@/components/ui';
import { LoginForm, useAppSession } from '@/features/auth';
import { useTheme } from '@/theme';

export default function LoginScreen() {
  const theme = useTheme();
  const session = useAppSession();

  const notice =
    session.status === 'unauthenticated' && session.reason === 'session-expired'
      ? 'Your session expired. Please sign in again.'
      : undefined;

  return (
    <Screen scrollable avoidKeyboard testID="login-screen">
      <View style={{ flex: 1, justifyContent: 'center', gap: theme.spacing['3xl'] }}>
        <View style={{ gap: theme.spacing.xs }}>
          <View
            style={{
              width: 56,
              height: 56,
              borderRadius: theme.radius.lg,
              backgroundColor: theme.colors.primary,
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: theme.spacing.lg,
            }}
          >
            <Text variant="displayMd" style={{ color: theme.colors.primaryForeground }}>
              C
            </Text>
          </View>

          <Text variant="displayMd">Club Desk</Text>
          <Text variant="body" color="textSecondary">
            Sign in to run your club.
          </Text>
        </View>

        {/*
          The login screen deliberately shows the product's own identity, not a
          club's. Branding is only known after we know which club the user
          belongs to, and guessing would mean flashing the wrong colours.
        */}
        <LoginForm {...(notice === undefined ? {} : { notice })} />
      </View>
    </Screen>
  );
}
