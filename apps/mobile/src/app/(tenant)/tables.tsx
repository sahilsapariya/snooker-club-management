import { LayoutGrid } from 'lucide-react-native';
import { useCallback, useMemo, useState } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';

import { Avatar, Badge, EmptyState, ErrorState, LoadingState, Screen, Text } from '@/components/ui';
import { useAppSession } from '@/features/auth';
import {
  SessionSheet,
  StartSessionSheet,
  useOpenSessions,
  useTimeCompletedWatcher,
  type SessionWithContext,
} from '@/features/sessions';
import { TableCard, useClubTables, type ClubTableOverview } from '@/features/tables';
import type { CurrencyConfig } from '@/lib/format';
import { useTheme } from '@/theme';

/**
 * The floor view, and the entry point to everything operational.
 *
 * Tapping a free table starts a session; tapping an occupied one opens it. The
 * table list and the open-session list are separate queries because occupancy
 * is derived, not stored - a session ending is what frees a table, so both are
 * invalidated together after every mutation.
 */
export default function TablesScreen() {
  const theme = useTheme();
  const session = useAppSession();

  const tenant = session.status === 'tenant-user' ? session.tenant : null;
  const tenantId = tenant?.id ?? null;

  const { data, isPending, isError, error, refetch, isRefetching, summary } =
    useClubTables(tenantId);
  const openSessions = useOpenSessions(tenantId);

  // Flags sessions whose booked time has elapsed. Never ends them. The club
  // name goes with it: an owner running several clubs on one phone must be able
  // to tell from the banner alone which counter needs attention.
  useTimeCompletedWatcher(tenantId, openSessions.data, {
    notify: true,
    ...(tenant ? { clubName: tenant.name } : {}),
  });

  const [startTable, setStartTable] = useState<ClubTableOverview | null>(null);
  const [openSessionId, setOpenSessionId] = useState<string | null>(null);

  const currency: CurrencyConfig = useMemo(
    () => ({
      code: tenant?.currency_code ?? 'INR',
      minorUnits: tenant?.currency_minor_units ?? 2,
    }),
    [tenant?.currency_code, tenant?.currency_minor_units],
  );

  const activeSession: SessionWithContext | null = useMemo(
    () => (openSessions.data ?? []).find((s) => s.id === openSessionId) ?? null,
    [openSessions.data, openSessionId],
  );

  const handleTablePress = useCallback((table: ClubTableOverview) => {
    if (table.is_occupied === true && table.active_session_id) {
      setOpenSessionId(table.active_session_id);
    } else if (table.is_active === true) {
      setStartTable(table);
    }
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: ClubTableOverview }) => (
      <TableCard table={item} currency={currency} onPress={() => handleTablePress(item)} />
    ),
    [currency, handleTablePress],
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
              onRefresh={() => {
                void refetch();
                void openSessions.refetch();
              }}
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

      <StartSessionSheet
        visible={startTable !== null}
        onClose={() => setStartTable(null)}
        table={startTable}
        tenantId={session.tenant.id}
        userId={session.profile.id}
        currency={currency}
      />

      <SessionSheet
        visible={activeSession !== null}
        onClose={() => setOpenSessionId(null)}
        session={activeSession}
        tenantId={session.tenant.id}
        userId={session.profile.id}
        currency={currency}
        billingSettings={session.billingSettings}
      />
    </Screen>
  );
}
