import { router } from 'expo-router';
import { Building2, LogOut, Plus, TriangleAlert, Users } from 'lucide-react-native';
import { RefreshControl, ScrollView, View } from 'react-native';

import {
  Button,
  Card,
  Divider,
  ErrorState,
  ListItem,
  LoadingState,
  Screen,
  SectionHeader,
  Text,
} from '@/components/ui';
import { useSignOut } from '@/features/auth';
import { usePlatformOverview } from '@/features/platform';
import { useTheme } from '@/theme';

/**
 * The platform operator's home.
 *
 * The product's hierarchy is PLATFORM → OWNER → CLUB → staff, and this screen
 * is the top of it. Owners come first because that is the commercial
 * relationship: the platform sells to an owner, and an owner runs one or many
 * clubs.
 *
 * Everything here is read through `platform_overview`, a SECURITY INVOKER
 * function — so the counts are whatever RLS lets the caller see, not a
 * privileged view of the whole database.
 */
export default function PlatformHomeScreen() {
  const theme = useTheme();
  const overview = usePlatformOverview();
  const signOut = useSignOut();

  const data = overview.data;
  const needsOwner = data?.clubs_without_owner ?? 0;

  return (
    <Screen padded={false} testID="platform-home">
      <ScrollView
        contentContainerStyle={{
          padding: theme.spacing.lg,
          gap: theme.spacing.xl,
          paddingBottom: theme.spacing['5xl'],
        }}
        refreshControl={
          <RefreshControl
            refreshing={overview.isRefetching}
            onRefresh={() => void overview.refetch()}
          />
        }
      >
        {overview.isError ? (
          <ErrorState error={overview.error} onRetry={() => void overview.refetch()} />
        ) : null}
        {overview.isPending ? <LoadingState label="Loading the platform" /> : null}

        {data ? (
          <>
            <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
              <Stat label="Owners" value={data.owners_count} />
              <Stat label="Clubs" value={data.clubs_count} />
              <Stat label="Staff" value={data.staff_count} />
            </View>

            <View>
              <SectionHeader title="Clubs by status" />
              <Card style={{ gap: theme.spacing.sm }}>
                <StatusRow label="Live" value={data.active_clubs} />
                <Divider />
                <StatusRow label="On trial" value={data.trial_clubs} />
                <Divider />
                <StatusRow label="Suspended" value={data.suspended_clubs} />
                <Divider />
                <StatusRow label="Archived" value={data.archived_clubs} />
              </Card>
            </View>

            {needsOwner > 0 ? (
              <Card
                style={{
                  gap: theme.spacing.xs,
                  borderColor: theme.colors.warning,
                  borderWidth: 1,
                }}
              >
                <View style={{ flexDirection: 'row', gap: theme.spacing.sm, alignItems: 'center' }}>
                  <TriangleAlert color={theme.colors.warning} size={18} />
                  <Text variant="titleSm">
                    {needsOwner} {needsOwner === 1 ? 'club has' : 'clubs have'} no owner
                  </Text>
                </View>
                <Text variant="caption" color="textMuted">
                  Nobody can configure these clubs or read their books. Assign an owner from the
                  club list.
                </Text>
              </Card>
            ) : null}
          </>
        ) : null}

        <View>
          <SectionHeader title="Administer" />
          <Card style={{ gap: theme.spacing.xs }}>
            <ListItem
              title="Owners"
              subtitle="The people who run clubs"
              icon={Users}
              showChevron
              onPress={() => router.push('/(platform)/owners')}
              testID="nav-owners"
            />
            <Divider />
            <ListItem
              title="Clubs"
              subtitle="Branding, status and ownership"
              icon={Building2}
              showChevron
              onPress={() => router.push('/(platform)/tenants')}
              testID="nav-clubs"
            />
            <Divider />
            <ListItem
              title="Create a club"
              subtitle="Set one up and hand it to an owner"
              icon={Plus}
              showChevron
              onPress={() => router.push('/(platform)/club-new')}
              testID="nav-create-club"
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
      </ScrollView>
    </Screen>
  );
}

function Stat({ label, value }: { readonly label: string; readonly value: number }) {
  const theme = useTheme();
  return (
    <Card style={{ flex: 1, alignItems: 'center', gap: theme.spacing.xs }}>
      <Text variant="titleLg">{value}</Text>
      <Text variant="caption" color="textMuted">
        {label}
      </Text>
    </Card>
  );
}

function StatusRow({ label, value }: { readonly label: string; readonly value: number }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <Text variant="bodySm" style={{ flex: 1 }}>
        {label}
      </Text>
      <Text variant="titleSm">{value}</Text>
    </View>
  );
}
