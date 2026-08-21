import { router, useLocalSearchParams } from 'expo-router';
import { Building2 } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';

import {
  Avatar,
  Badge,
  Button,
  Card,
  Divider,
  EmptyState,
  ErrorState,
  ListItem,
  LoadingState,
  Screen,
  SectionHeader,
  Sheet,
  Text,
  useToast,
} from '@/components/ui';
import {
  useOwnerClubs,
  usePlatformOwners,
  useSetOwnerActive,
  type PlatformOwnerClub,
} from '@/features/platform';
import { useTheme } from '@/theme';

/**
 * One owner, and every club they run.
 *
 * This is the screen the multi-club model exists for: it shows, in one place,
 * that a single login reaches several clubs — and lets the platform disable
 * that login across all of them at once when a relationship ends.
 *
 * Disabling sets `profiles.is_active = false`, which `app.tenant_ids()` checks.
 * It is therefore not a UI-level restriction: every RLS policy in the schema
 * stops matching for that user at the same instant.
 */
export default function OwnerDetailScreen() {
  const theme = useTheme();
  const toast = useToast();
  const { id } = useLocalSearchParams<{ id: string }>();
  const ownerUserId = id ?? null;

  const owners = usePlatformOwners();
  const clubs = useOwnerClubs(ownerUserId);
  const setActive = useSetOwnerActive();
  const [confirming, setConfirming] = useState(false);

  const owner = useMemo(
    () => (owners.data ?? []).find((candidate) => candidate.user_id === ownerUserId) ?? null,
    [owners.data, ownerUserId],
  );

  if (owners.isPending || clubs.isPending) {
    return (
      <Screen>
        <LoadingState label="Loading owner" />
      </Screen>
    );
  }

  if (!owner) {
    return (
      <Screen>
        <EmptyState
          title="Owner not found"
          description="This account may have been removed, or it no longer owns any club."
        />
      </Screen>
    );
  }

  const name = owner.full_name ?? owner.email;

  return (
    <Screen padded={false} testID="owner-detail-screen">
      <ScrollView
        contentContainerStyle={{
          padding: theme.spacing.lg,
          gap: theme.spacing.xl,
          paddingBottom: theme.spacing['5xl'],
        }}
        refreshControl={
          <RefreshControl refreshing={clubs.isRefetching} onRefresh={() => void clubs.refetch()} />
        }
      >
        {clubs.isError ? (
          <ErrorState error={clubs.error} onRetry={() => void clubs.refetch()} />
        ) : null}

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
          <Avatar name={name} size={56} />
          <View style={{ flex: 1, gap: theme.spacing.xs }}>
            <Text variant="titleMd">{name}</Text>
            <Text variant="bodySm" color="textMuted">
              {owner.email}
            </Text>
            {owner.phone ? (
              <Text variant="caption" color="textMuted">
                {owner.phone}
              </Text>
            ) : null}
          </View>
          <Badge
            label={owner.is_active ? 'Active' : 'Disabled'}
            tone={owner.is_active ? 'success' : 'error'}
          />
        </View>

        <View>
          <SectionHeader
            title="Clubs"
            subtitle={`${owner.clubs_count} in total · ${owner.active_clubs} live or on trial`}
          />

          {(clubs.data ?? []).length === 0 ? (
            <EmptyState
              icon={Building2}
              title="No clubs"
              description="This owner has no clubs assigned. Create one, or assign an existing club to them."
            />
          ) : (
            <Card style={{ gap: theme.spacing.xs }}>
              {(clubs.data ?? []).map((club, index) => (
                <View key={club.tenant_id}>
                  {index > 0 ? <Divider /> : null}
                  <ClubRow club={club} />
                </View>
              ))}
            </Card>
          )}
        </View>

        <Button
          label={owner.is_active ? 'Disable this account' : 'Re-enable this account'}
          variant={owner.is_active ? 'outline' : 'primary'}
          fullWidth
          loading={setActive.isPending}
          onPress={() => setConfirming(true)}
          testID="toggle-owner-active"
        />

        <Text variant="caption" color="textMuted">
          Disabling signs this person out of every club they run at once. Their clubs keep operating
          — the receptionists are unaffected.
        </Text>
      </ScrollView>

      <Sheet
        visible={confirming}
        onClose={() => setConfirming(false)}
        title={owner.is_active ? `Disable ${name}?` : `Re-enable ${name}?`}
        subtitle={
          owner.is_active
            ? `They lose access to all ${owner.clubs_count} of their clubs immediately.`
            : 'They regain access to every club they own.'
        }
        testID="confirm-owner-status"
      >
        <View style={{ gap: theme.spacing.lg }}>
          <Button
            label={owner.is_active ? 'Yes, disable the account' : 'Yes, re-enable the account'}
            fullWidth
            loading={setActive.isPending}
            onPress={() =>
              setActive.mutate(
                { ownerUserId: owner.user_id, isActive: !owner.is_active },
                {
                  onSuccess: () => {
                    toast.success(owner.is_active ? `${name} disabled` : `${name} re-enabled`);
                    setConfirming(false);
                  },
                  onError: (error) => toast.error(error, 'Could not change the account.'),
                },
              )
            }
          />
          <Button label="Cancel" variant="ghost" fullWidth onPress={() => setConfirming(false)} />
        </View>
      </Sheet>
    </Screen>
  );
}

function ClubRow({ club }: { readonly club: PlatformOwnerClub }) {
  const theme = useTheme();

  return (
    <ListItem
      title={club.name}
      subtitle={[club.city, `${club.tables_count} tables`, `${club.staff_count} staff`]
        .filter(Boolean)
        .join(' · ')}
      showChevron
      onPress={() => router.push(`/(platform)/tenant/${club.tenant_id}`)}
      testID={`owner-club-${club.slug}`}
      trailing={
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
          <Badge label={statusLabel(club.status)} tone={statusTone(club.status)} />
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

function statusLabel(status: string): string {
  if (status === 'ACTIVE') return 'Live';
  if (status === 'TRIAL') return 'Trial';
  if (status === 'SUSPENDED') return 'Suspended';
  return 'Archived';
}

function statusTone(status: string): 'success' | 'warning' | 'error' | 'neutral' {
  if (status === 'ACTIVE') return 'success';
  if (status === 'TRIAL') return 'warning';
  if (status === 'SUSPENDED') return 'error';
  return 'neutral';
}
