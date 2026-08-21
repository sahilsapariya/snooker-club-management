import { Redirect, router } from 'expo-router';
import { LogOut } from 'lucide-react-native';
import { ScrollView, View } from 'react-native';

import { Button, LoadingState, Screen, SectionHeader, Text } from '@/components/ui';
import { ClubPicker, useAppSession, useSignOut, useSwitchClub } from '@/features/auth';
import { useTheme } from '@/theme';

/**
 * "Which club are you working in today?"
 *
 * Only ever shown to someone who genuinely has a choice. A user with one club
 * is sent straight through - `resolveActiveClub` returns their single club, so
 * `useAppSession` never enters the selection state and this screen never
 * renders for them.
 *
 * The choice is remembered, so this is a first-run screen rather than a daily
 * toll. It reappears only when the remembered club stops being reachable.
 */
export default function SelectClubScreen() {
  const theme = useTheme();
  const session = useAppSession();
  const switchClub = useSwitchClub();
  const signOut = useSignOut();

  if (session.status === 'loading') {
    return (
      <Screen>
        <LoadingState label="Loading your clubs" />
      </Screen>
    );
  }

  // Reached directly, or after the selection resolved itself. The gate knows
  // where this user belongs; don't duplicate that decision here.
  if (session.status !== 'club-selection') {
    return <Redirect href="/" />;
  }

  async function handleSelect(tenantId: string): Promise<void> {
    await switchClub(tenantId);
    router.replace('/(tenant)/tables');
  }

  return (
    <Screen padded={false} testID="select-club-screen">
      <ScrollView
        contentContainerStyle={{
          padding: theme.spacing.lg,
          gap: theme.spacing.xl,
          paddingBottom: theme.spacing['5xl'],
        }}
      >
        <View style={{ gap: theme.spacing.xs, marginTop: theme.spacing.xl }}>
          <Text variant="titleLg">Choose a club</Text>
          <Text variant="bodySm" color="textMuted">
            {session.profile.full_name ?? session.profile.email} · {session.clubs.length} clubs
          </Text>
        </View>

        <View>
          <SectionHeader
            title="Your clubs"
            subtitle="Each club keeps its own tables, staff, prices and books"
          />
          <ClubPicker
            clubs={session.clubs}
            activeTenantId={null}
            onSelect={(id) => void handleSelect(id)}
            testID="club-list"
          />
        </View>

        <Button
          label="Sign out"
          variant="ghost"
          icon={LogOut}
          fullWidth
          onPress={() => void signOut()}
        />
      </ScrollView>
    </Screen>
  );
}
