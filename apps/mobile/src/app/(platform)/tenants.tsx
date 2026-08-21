import { router } from 'expo-router';
import { Building2, Plus, TriangleAlert } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';

import {
  Badge,
  Button,
  Card,
  Divider,
  EmptyState,
  ErrorState,
  Input,
  ListItem,
  LoadingState,
  Screen,
  SectionHeader,
} from '@/components/ui';
import { usePlatformClubs, type PlatformClub } from '@/features/platform';
import { useTheme } from '@/theme';

const STATUS_TONE: Record<string, 'success' | 'info' | 'warning' | 'neutral'> = {
  ACTIVE: 'success',
  TRIAL: 'info',
  SUSPENDED: 'warning',
  ARCHIVED: 'neutral',
};

/**
 * Every club on the platform, with the owner attached.
 *
 * Owner-first is the point. In the old single-club world a club list was the
 * whole model; now a club without a named owner is an incomplete record, so the
 * owner is shown on every row and the ones missing it are pulled to the top.
 */
export default function PlatformClubsScreen() {
  const theme = useTheme();
  const clubs = usePlatformClubs();
  const [search, setSearch] = useState('');

  const { ownerless, matching } = useMemo(() => {
    const all = clubs.data ?? [];
    const needle = search.trim().toLowerCase();
    const filtered =
      needle === ''
        ? all
        : all.filter(
            (club) =>
              club.name.toLowerCase().includes(needle) ||
              club.slug.toLowerCase().includes(needle) ||
              (club.owner_email ?? '').toLowerCase().includes(needle) ||
              (club.city ?? '').toLowerCase().includes(needle),
          );

    return {
      ownerless: filtered.filter((club) => club.owner_user_id === null),
      matching: filtered.filter((club) => club.owner_user_id !== null),
    };
  }, [clubs.data, search]);

  return (
    <Screen padded={false} testID="platform-tenants-screen">
      <ScrollView
        contentContainerStyle={{
          padding: theme.spacing.lg,
          gap: theme.spacing.xl,
          paddingBottom: theme.spacing['5xl'],
        }}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={clubs.isRefetching} onRefresh={() => void clubs.refetch()} />
        }
      >
        {clubs.isError ? (
          <ErrorState error={clubs.error} onRetry={() => void clubs.refetch()} />
        ) : null}
        {clubs.isPending ? <LoadingState label="Loading clubs" /> : null}

        <Input
          placeholder="Search by club, owner or city"
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
          testID="club-search"
        />

        {ownerless.length > 0 ? (
          <View>
            <SectionHeader
              title="No owner assigned"
              subtitle="Nobody can configure these clubs or read their books"
            />
            <Card
              style={{ gap: theme.spacing.xs, borderColor: theme.colors.warning, borderWidth: 1 }}
            >
              {ownerless.map((club, index) => (
                <View key={club.tenant_id}>
                  {index > 0 ? <Divider /> : null}
                  <ClubRow club={club} />
                </View>
              ))}
            </Card>
          </View>
        ) : null}

        {matching.length > 0 ? (
          <View>
            <SectionHeader
              title="Clubs"
              subtitle={`${matching.length} with an owner`}
              action={{ label: 'New club', onPress: () => router.push('/(platform)/club-new') }}
            />
            <Card style={{ gap: theme.spacing.xs }}>
              {matching.map((club, index) => (
                <View key={club.tenant_id}>
                  {index > 0 ? <Divider /> : null}
                  <ClubRow club={club} />
                </View>
              ))}
            </Card>
          </View>
        ) : null}

        {!clubs.isPending && (clubs.data ?? []).length === 0 ? (
          <EmptyState
            icon={Building2}
            title="No clubs yet"
            description="Create the first club and hand it to an owner."
          />
        ) : null}

        {!clubs.isPending &&
        (clubs.data ?? []).length > 0 &&
        matching.length + ownerless.length === 0 ? (
          <EmptyState title="Nothing matches" description={`No club matches “${search}”.`} />
        ) : null}

        <Button
          label="Create a club"
          icon={Plus}
          variant="outline"
          fullWidth
          onPress={() => router.push('/(platform)/club-new')}
        />
      </ScrollView>
    </Screen>
  );
}

function ClubRow({ club }: { readonly club: PlatformClub }) {
  const theme = useTheme();

  return (
    <ListItem
      title={club.name}
      subtitle={
        club.owner_user_id === null
          ? 'No owner assigned'
          : `${club.owner_name ?? club.owner_email} · ${club.staff_count} staff · ${club.tables_count} tables`
      }
      showChevron
      onPress={() => router.push(`/(platform)/tenant/${club.tenant_id}`)}
      testID={`club-row-${club.slug}`}
      trailing={
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
          {club.owner_user_id === null ? (
            <TriangleAlert color={theme.colors.warning} size={16} />
          ) : null}
          <Badge label={label(club.status)} tone={STATUS_TONE[club.status] ?? 'neutral'} />
          <View
            style={{
              width: 18,
              height: 18,
              borderRadius: 9,
              backgroundColor: club.primary_color || theme.colors.primary,
            }}
          />
        </View>
      }
    />
  );
}

function label(status: string): string {
  if (status === 'ACTIVE') return 'Live';
  if (status === 'TRIAL') return 'Trial';
  if (status === 'SUSPENDED') return 'Suspended';
  return 'Archived';
}
