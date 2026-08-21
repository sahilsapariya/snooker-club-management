import { Timer as TimerIcon } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';

import {
  Badge,
  Card,
  Divider,
  EmptyState,
  ErrorState,
  LoadingState,
  MoneyValue,
  PaymentStatusBadge,
  Screen,
  SectionHeader,
  SessionStatusBadge,
  Text,
  Timer,
} from '@/components/ui';
import { useAppSession } from '@/features/auth';
import {
  SessionSheet,
  useOpenSessions,
  useRecentSessions,
  type SessionWithContext,
} from '@/features/sessions';
import {
  formatDateTime,
  formatDuration,
  type CurrencyConfig,
  type TenantClock,
} from '@/lib/format';
import { useTheme } from '@/theme';

/**
 * Sessions workspace: what is running now, and what closed recently.
 *
 * The recent list shows actual duration alongside the amount charged, on
 * purpose - the two are different numbers and staff should be able to see both.
 */
export default function SessionsScreen() {
  const theme = useTheme();
  const session = useAppSession();

  const tenant = session.status === 'tenant-user' ? session.tenant : null;
  const tenantId = tenant?.id ?? null;

  const open = useOpenSessions(tenantId);
  const recent = useRecentSessions(tenantId);
  const [openSessionId, setOpenSessionId] = useState<string | null>(null);

  const currency: CurrencyConfig = useMemo(
    () => ({
      code: tenant?.currency_code ?? 'INR',
      minorUnits: tenant?.currency_minor_units ?? 2,
    }),
    [tenant?.currency_code, tenant?.currency_minor_units],
  );

  const clock: TenantClock = useMemo(
    () => ({
      timezone: tenant?.timezone ?? 'Asia/Kolkata',
      businessDayCutoff: tenant?.business_day_cutoff ?? '00:00:00',
    }),
    [tenant?.timezone, tenant?.business_day_cutoff],
  );

  const selected: SessionWithContext | null = useMemo(
    () => (open.data ?? []).find((s) => s.id === openSessionId) ?? null,
    [open.data, openSessionId],
  );

  if (session.status !== 'tenant-user') {
    return (
      <Screen>
        <LoadingState />
      </Screen>
    );
  }

  if (open.isPending) {
    return (
      <Screen>
        <LoadingState label="Loading sessions" />
      </Screen>
    );
  }

  if (open.isError) {
    return (
      <Screen>
        <ErrorState error={open.error} onRetry={() => void open.refetch()} />
      </Screen>
    );
  }

  const openSessions = open.data ?? [];
  const recentSessions = recent.data ?? [];

  return (
    <Screen padded={false} testID="sessions-screen">
      <ScrollView
        contentContainerStyle={{
          padding: theme.spacing.lg,
          gap: theme.spacing.xl,
          paddingBottom: theme.spacing['4xl'],
        }}
        refreshControl={
          <RefreshControl
            refreshing={open.isRefetching}
            onRefresh={() => {
              void open.refetch();
              void recent.refetch();
            }}
            tintColor={theme.colors.primary}
          />
        }
      >
        <View>
          <SectionHeader title="In play" subtitle={`${openSessions.length} open`} />
          {openSessions.length === 0 ? (
            <EmptyState
              icon={TimerIcon}
              title="Nothing in play"
              description="Start a session from the Tables tab."
            />
          ) : (
            <View style={{ gap: theme.spacing.md }}>
              {openSessions.map((item) => (
                <Card
                  key={item.id}
                  elevated
                  onPress={() => setOpenSessionId(item.id)}
                  style={{ gap: theme.spacing.sm }}
                >
                  <View
                    style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}
                  >
                    <View style={{ flex: 1 }}>
                      <Text variant="titleMd">{item.club_table?.name ?? 'Table'}</Text>
                      <Text variant="caption" color="textMuted">
                        {item.customer_name ?? 'Walk-in'} · started{' '}
                        {formatDateTime(item.started_at, clock)}
                      </Text>
                    </View>
                    <SessionStatusBadge status={item.status} />
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Timer
                      startedAtIso={item.started_at}
                      variant="titleMd"
                      tone={item.status === 'TIME_COMPLETED' ? 'warning' : 'textPrimary'}
                    />
                    <View style={{ flex: 1 }} />
                    {item.session_items.length > 0 ? (
                      <Badge label={`${item.session_items.length} items`} tone="neutral" />
                    ) : null}
                  </View>
                </Card>
              ))}
            </View>
          )}
        </View>

        <View>
          <SectionHeader title="Recently closed" subtitle="Actual time played vs amount charged" />
          {recent.isPending ? (
            <LoadingState label="Loading history" />
          ) : recentSessions.length === 0 ? (
            <Text variant="bodySm" color="textMuted">
              No closed sessions yet.
            </Text>
          ) : (
            <Card style={{ gap: theme.spacing.sm }}>
              {recentSessions.map((item, index) => (
                <View key={item.id}>
                  {index > 0 ? <Divider style={{ marginVertical: theme.spacing.sm }} /> : null}
                  <View
                    style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}
                  >
                    <View style={{ flex: 1 }}>
                      <Text variant="titleSm">{item.club_table?.name ?? 'Table'}</Text>
                      <Text variant="caption" color="textMuted">
                        {item.ended_at ? formatDateTime(item.ended_at, clock) : '—'} ·{' '}
                        {formatDuration(item.actual_duration_seconds ?? 0)} played
                      </Text>
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 2 }}>
                      <MoneyValue
                        amountMinor={item.total_amount_minor ?? 0}
                        currency={currency}
                        variant="titleSm"
                      />
                      <PaymentStatusBadge status={item.payment_status} />
                    </View>
                  </View>
                </View>
              ))}
            </Card>
          )}
        </View>
      </ScrollView>

      <SessionSheet
        visible={selected !== null}
        onClose={() => setOpenSessionId(null)}
        session={selected}
        tenantId={session.tenant.id}
        userId={session.profile.id}
        currency={currency}
        billingSettings={session.billingSettings}
      />
    </Screen>
  );
}
