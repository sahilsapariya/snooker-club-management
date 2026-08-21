import { router } from 'expo-router';
import { Users } from 'lucide-react-native';
import { RefreshControl, ScrollView, View } from 'react-native';

import {
  Avatar,
  Badge,
  Card,
  Divider,
  EmptyState,
  ErrorState,
  ListItem,
  LoadingState,
  Screen,
  SectionHeader,
  Text,
} from '@/components/ui';
import { usePlatformOwners, type PlatformOwner } from '@/features/platform';
import { useTheme } from '@/theme';

/**
 * Every club owner on the platform.
 *
 * One row per person, not per club — an owner running four clubs appears once,
 * with a count. That is the relationship the platform actually sells and bills
 * against; flattening it to clubs would hide it.
 */
export default function OwnersScreen() {
  const theme = useTheme();
  const owners = usePlatformOwners();

  const list = owners.data ?? [];
  const multiClub = list.filter((owner) => owner.clubs_count > 1);

  return (
    <Screen padded={false} testID="owners-screen">
      <ScrollView
        contentContainerStyle={{
          padding: theme.spacing.lg,
          gap: theme.spacing.xl,
          paddingBottom: theme.spacing['5xl'],
        }}
        refreshControl={
          <RefreshControl
            refreshing={owners.isRefetching}
            onRefresh={() => void owners.refetch()}
          />
        }
      >
        {owners.isError ? (
          <ErrorState error={owners.error} onRetry={() => void owners.refetch()} />
        ) : null}
        {owners.isPending ? <LoadingState label="Loading owners" /> : null}

        {!owners.isPending && list.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No owners yet"
            description="An owner appears here as soon as they are given their first club."
          />
        ) : null}

        {list.length > 0 ? (
          <View>
            <SectionHeader
              title="Owners"
              subtitle={`${list.length} people · ${multiClub.length} running more than one club`}
            />
            <Card style={{ gap: theme.spacing.xs }}>
              {list.map((owner, index) => (
                <View key={owner.user_id}>
                  {index > 0 ? <Divider /> : null}
                  <OwnerRow owner={owner} />
                </View>
              ))}
            </Card>
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function OwnerRow({ owner }: { readonly owner: PlatformOwner }) {
  const theme = useTheme();
  const name = owner.full_name ?? owner.email;
  const suspendedClubs = owner.clubs_count - owner.active_clubs;

  return (
    <ListItem
      title={name}
      subtitle={owner.email}
      showChevron
      onPress={() => router.push(`/(platform)/owner/${owner.user_id}`)}
      testID={`owner-row-${owner.user_id}`}
      trailing={
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
          <View style={{ alignItems: 'flex-end' }}>
            <Text variant="titleSm">{owner.clubs_count}</Text>
            <Text variant="caption" color="textMuted">
              {owner.clubs_count === 1 ? 'club' : 'clubs'}
            </Text>
          </View>
          {owner.is_active ? null : <Badge label="Disabled" tone="error" />}
          {suspendedClubs > 0 && owner.is_active ? (
            <Badge label={`${suspendedClubs} down`} tone="warning" />
          ) : null}
          <Avatar name={name} size={36} />
        </View>
      }
    />
  );
}
