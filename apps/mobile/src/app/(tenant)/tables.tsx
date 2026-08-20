import { LayoutGrid } from 'lucide-react-native';
import { useCallback } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';

import { Avatar, Badge, EmptyState, ErrorState, LoadingState, Screen, Text } from '@/components/ui';
import { useAppSession } from '@/features/auth';
import { TableCard, useClubTables, type ClubTableOverview } from '@/features/tables';
import type { CurrencyConfig } from '@/lib/format';
import { useTheme } from '@/theme';

/**
 * The Tables screen: real rows, from Supabase, filtered by Row Level Security.
 *
 * This is the screen that proves the whole stack end to end - sign in, resolve
 * the club, theme from its branding, and read data that the database has
 * already scoped to that club.
 */
export default function TablesScreen() {
  const theme = useTheme();
  const session = useAppSession();

  const tenant = session.status === 'tenant-user' ? session.tenant : null;
  const { data, isPending, isError, error, refetch, isRefetching, summary } = useClubTables(
    tenant?.id ?? null,
  );

  const currency: CurrencyConfig = {
    code: tenant?.currency_code ?? 'INR',
    minorUnits: tenant?.currency_minor_units ?? 2,
  };

  const renderItem = useCallback(
    ({ item }: { item: ClubTableOverview }) => <TableCard table={item} currency={currency} />,
    // `currency` is derived from the tenant row, which changes only on re-theme.
    [currency.code, currency.minorUnits], // eslint-disable-line react-hooks/exhaustive-deps
  );

  if (session.status !== 'tenant-user') {
    return (
      <Screen>
        <LoadingState />
      </Screen>
    );
  }

  return (
    <Screen padded={false} testID="tables-screen">
      <View style={{ paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
          <View style={{ flex: 1 }}>
            <Text variant="caption" color="textMuted">
              {session.role === 'OWNER' ? 'Owner' : 'Reception'}
            </Text>
            <Text variant="displayMd" numberOfLines={1}>
              {session.tenant.name}
            </Text>
          </View>
          <Avatar name={session.profile.full_name ?? session.profile.email} />
        </View>

        <View
          style={{
            flexDirection: 'row',
            gap: theme.spacing.sm,
            marginTop: theme.spacing.lg,
            marginBottom: theme.spacing.md,
            flexWrap: 'wrap',
          }}
        >
          <Badge label={`${summary.occupied} in play`} tone="info" />
          <Badge label={`${summary.available} free`} tone="success" />
          {summary.needingAttention > 0 ? (
            <Badge label={`${summary.needingAttention} need attention`} tone="warning" />
          ) : null}
        </View>
      </View>

      {isPending ? (
        <LoadingState label="Loading tables" />
      ) : isError ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : (
        <FlatList
          data={data}
          keyExtractor={(item) => item.id ?? ''}
          renderItem={renderItem}
          contentContainerStyle={{
            paddingHorizontal: theme.spacing.lg,
            paddingBottom: theme.spacing['4xl'],
            gap: theme.spacing.md,
            flexGrow: 1,
          }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={() => void refetch()}
              tintColor={theme.colors.primary}
            />
          }
          ListEmptyComponent={
            <EmptyState
              icon={LayoutGrid}
              title="No tables set up yet"
              description={
                session.role === 'OWNER'
                  ? 'Add your first snooker or pool table to start taking sessions.'
                  : 'Ask the club owner to add the tables for this club.'
              }
            />
          }
        />
      )}
    </Screen>
  );
}
