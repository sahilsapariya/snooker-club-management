import { router } from 'expo-router';
import {
  BarChart3,
  LogOut,
  Settings as SettingsIcon,
  SlidersHorizontal,
} from 'lucide-react-native';
import { ScrollView, View } from 'react-native';

import {
  Avatar,
  Badge,
  Button,
  Card,
  Divider,
  ListItem,
  LoadingState,
  Screen,
  Text,
} from '@/components/ui';
import { useAppSession, useSignOut } from '@/features/auth';
import { useTheme } from '@/theme';

/**
 * Secondary navigation.
 *
 * The tab bar holds the four things a receptionist touches during a shift -
 * tables, sessions, cash, alerts. Everything used occasionally lives here, so
 * the primary tabs stay big enough to hit one-handed while standing at a
 * counter.
 *
 * Owner-only destinations are still listed for a receptionist but marked, so
 * they learn the app has them and who to ask - rather than the app appearing to
 * be missing features. The screens themselves refuse the write regardless.
 */
export default function MoreScreen() {
  const theme = useTheme();
  const session = useAppSession();
  const signOut = useSignOut();

  if (session.status !== 'tenant-user') {
    return (
      <Screen>
        <LoadingState />
      </Screen>
    );
  }

  const isOwner = session.role === 'OWNER';

  return (
    <Screen padded={false} testID="more-screen">
      <ScrollView
        contentContainerStyle={{
          padding: theme.spacing.lg,
          gap: theme.spacing.xl,
          paddingBottom: theme.spacing['5xl'],
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
          <Avatar name={session.profile.full_name ?? session.profile.email} size={48} />
          <View style={{ flex: 1 }}>
            <Text variant="titleMd" numberOfLines={1}>
              {session.profile.full_name ?? session.profile.email}
            </Text>
            <Text variant="caption" color="textMuted" numberOfLines={1}>
              {session.tenant.name}
            </Text>
          </View>
          <Badge label={isOwner ? 'Owner' : 'Reception'} tone="brand" />
        </View>

        <Card style={{ gap: theme.spacing.xs }}>
          <ListItem
            title="Reports"
            subtitle="Takings, tables, products and expenses over time"
            icon={BarChart3}
            showChevron
            onPress={() => router.push('/(tenant)/reports')}
          />
          <Divider />
          <ListItem
            title="Manage club"
            subtitle={isOwner ? 'Products and pricing' : 'Owner only'}
            icon={SlidersHorizontal}
            showChevron
            onPress={() => router.push('/(tenant)/manage')}
          />
          <Divider />
          <ListItem
            title="Settings"
            subtitle="Club details and billing rules"
            icon={SettingsIcon}
            showChevron
            onPress={() => router.push('/(tenant)/settings')}
          />
        </Card>

        <Button
          label="Sign out"
          variant="outline"
          icon={LogOut}
          fullWidth
          onPress={() => void signOut()}
        />

        <Text variant="caption" color="textMuted" align="center">
          Club Desk
        </Text>
      </ScrollView>
    </Screen>
  );
}
