import { router } from 'expo-router';
import {
  BarChart3,
  Building2,
  Calculator,
  History,
  LogOut,
  Receipt,
  Settings as SettingsIcon,
  SlidersHorizontal,
  Table2,
  Users,
} from 'lucide-react-native';
import { useState } from 'react';
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
  SectionHeader,
  Text,
} from '@/components/ui';
import { ClubSwitcherSheet, useAppSession, useSignOut } from '@/features/auth';
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
 *
 * "Switch club" appears only for someone with more than one, and only ever
 * moves between clubs they hold a membership in. The list it offers comes from
 * the server, not from anything the client chose.
 */
export default function MoreScreen() {
  const theme = useTheme();
  const session = useAppSession();
  const signOut = useSignOut();
  const [switching, setSwitching] = useState(false);

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

        {session.canSwitchClubs ? (
          <Card style={{ gap: theme.spacing.xs }}>
            <ListItem
              title="Switch club"
              subtitle={`You run ${session.clubs.length} clubs`}
              icon={Building2}
              showChevron
              onPress={() => setSwitching(true)}
              testID="more-switch-club"
            />
          </Card>
        ) : null}

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
            title="Expenses"
            subtitle="Money out, over a period, with corrections"
            icon={Receipt}
            showChevron
            onPress={() => router.push('/(tenant)/expenses')}
            testID="more-expenses"
          />
          <Divider />
          <ListItem
            title="Settings"
            subtitle="Club details, your account and this club's rules at a glance"
            icon={SettingsIcon}
            showChevron
            onPress={() => router.push('/(tenant)/settings')}
          />
        </Card>

        <View>
          <SectionHeader
            title="Run the club"
            {...(isOwner ? {} : { subtitle: 'Owner only — you can look, not change' })}
          />
          <Card style={{ gap: theme.spacing.xs }}>
            <ListItem
              title="Tables"
              subtitle={isOwner ? 'Add, rename and retire tables' : 'Owner only'}
              icon={Table2}
              showChevron
              onPress={() => router.push('/(tenant)/tables-setup')}
              testID="more-tables-setup"
            />
            <Divider />
            <ListItem
              title="Staff"
              subtitle={isOwner ? 'Who works here and what they can reach' : 'Owner only'}
              icon={Users}
              showChevron
              onPress={() => router.push('/(tenant)/staff')}
              testID="more-staff"
            />
            <Divider />
            <ListItem
              title="Products and pricing"
              subtitle={isOwner ? 'The catalogue and the table rates' : 'Owner only'}
              icon={SlidersHorizontal}
              showChevron
              onPress={() => router.push('/(tenant)/manage')}
            />
            <Divider />
            <ListItem
              title="Billing rules"
              subtitle={isOwner ? 'How time becomes money' : 'Owner only'}
              icon={Calculator}
              showChevron
              onPress={() => router.push('/(tenant)/billing')}
              testID="more-billing"
            />
            <Divider />
            <ListItem
              title="Activity"
              subtitle={isOwner ? 'Who changed what, and when' : 'Owner only'}
              icon={History}
              showChevron
              onPress={() => router.push('/(tenant)/activity')}
              testID="more-activity"
            />
          </Card>
        </View>

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

      <ClubSwitcherSheet
        visible={switching}
        onClose={() => setSwitching(false)}
        clubs={session.clubs}
        activeTenantId={session.tenant.id}
      />
    </Screen>
  );
}
