import {
  AlertCircle,
  Coffee,
  LayoutGrid,
  Receipt,
  TrendingDown,
  TrendingUp,
} from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';

import {
  BarChart,
  Badge,
  Card,
  Divider,
  ErrorState,
  ListItem,
  LoadingState,
  MoneyValue,
  Screen,
  SectionHeader,
  Select,
  Text,
} from '@/components/ui';
import { useAppSession } from '@/features/auth';
import {
  percentChange,
  resolveRange,
  useOutstandingSessions,
  useReports,
  type RangePreset,
} from '@/features/reports';
import { formatDuration, formatMoney, type CurrencyConfig, type TenantClock } from '@/lib/format';
import { useTheme } from '@/theme';

/**
 * Reports.
 *
 * Two decisions worth knowing about:
 *
 * 1. Every figure is aggregated in Postgres. The screen renders numbers; it
 *    does not sum sessions.
 * 2. Actual played time and billed time are shown side by side. The gap
 *    between them is the club's rounding and grace policy made visible, and
 *    an owner should be able to see what those settings cost or earn.
 */
export default function ReportsScreen() {
  const theme = useTheme();
  const session = useAppSession();

  const tenant = session.status === 'tenant-user' ? session.tenant : null;
  const tenantId = tenant?.id ?? null;

  const [preset, setPreset] = useState<RangePreset>('week');

  const clock: TenantClock = useMemo(
    () => ({
      timezone: tenant?.timezone ?? 'Asia/Kolkata',
      businessDayCutoff: tenant?.business_day_cutoff ?? '00:00:00',
    }),
    [tenant?.timezone, tenant?.business_day_cutoff],
  );

  const currency: CurrencyConfig = useMemo(
    () => ({
      code: tenant?.currency_code ?? 'INR',
      minorUnits: tenant?.currency_minor_units ?? 2,
    }),
    [tenant?.currency_code, tenant?.currency_minor_units],
  );

  const range = useMemo(() => resolveRange(preset, clock), [preset, clock]);
  const reports = useReports(tenantId, range);
  const outstanding = useOutstandingSessions(tenantId);

  if (session.status !== 'tenant-user') {
    return (
      <Screen>
        <LoadingState />
      </Screen>
    );
  }

  if (reports.isPending) {
    return (
      <Screen>
        <LoadingState label="Crunching the numbers" />
      </Screen>
    );
  }

  if (reports.isError) {
    return (
      <Screen>
        <ErrorState error={reports.error} onRetry={() => void reports.refetch()} />
      </Screen>
    );
  }

  const summary = reports.summary;
  const collected = Number(summary?.collected_minor ?? 0);
  const previousCollected = Number(reports.previousSummary?.collected_minor ?? 0);
  const change = percentChange(collected, previousCollected);

  const totalExpenses = reports.expenses.reduce((sum, e) => sum + Number(e.total_minor), 0);
  const net = collected - totalExpenses;

  const outstandingTotal = (outstanding.data ?? []).reduce(
    (sum, s) => sum + Number(s.outstanding_minor ?? 0),
    0,
  );

  return (
    <Screen padded={false} testID="reports-screen">
      <View style={{ padding: theme.spacing.lg, gap: theme.spacing.lg }}>
        <View style={{ gap: theme.spacing.xs }}>
          <Text variant="caption" color="textMuted">
            {range.from} to {range.to}
          </Text>
          <Text variant="displayMd">Reports</Text>
        </View>

        <Select
          value={preset}
          onChange={setPreset}
          options={[
            { value: 'today', label: 'Today' },
            { value: 'week', label: '7 days' },
            { value: 'month', label: '30 days' },
            { value: 'quarter', label: '90 days' },
          ]}
        />
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: theme.spacing['5xl'],
          gap: theme.spacing.xl,
        }}
        refreshControl={
          <RefreshControl
            refreshing={reports.isRefetching}
            onRefresh={() => void reports.refetch()}
            tintColor={theme.colors.primary}
          />
        }
      >
        {/* ---- Headline ------------------------------------------------ */}
        <Card elevated style={{ gap: theme.spacing.md }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="label" color="textSecondary">
                Collected
              </Text>
              <MoneyValue amountMinor={collected} currency={currency} variant="displayMd" />
            </View>
            {change !== null ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xs }}>
                {change >= 0 ? (
                  <TrendingUp size={16} color={theme.colors.success} />
                ) : (
                  <TrendingDown size={16} color={theme.colors.error} />
                )}
                <Text variant="label" color={change >= 0 ? 'success' : 'error'}>
                  {change >= 0 ? '+' : ''}
                  {change.toFixed(0)}%
                </Text>
              </View>
            ) : (
              <Badge label="No prior period" tone="neutral" />
            )}
          </View>

          <Divider />

          <Stat label="Sessions" value={String(summary?.sessions_count ?? 0)} />
          <Stat
            label="Average session"
            value={formatMoney(Number(summary?.average_session_minor ?? 0), { currency })}
          />
          <Stat label="Cash" value={formatMoney(Number(summary?.cash_minor ?? 0), { currency })} />
          <Stat
            label="Card, UPI & transfer"
            value={formatMoney(Number(summary?.non_cash_minor ?? 0), { currency })}
          />
          {Number(summary?.discount_minor ?? 0) > 0 ? (
            <Stat
              label="Discounts given"
              value={formatMoney(Number(summary?.discount_minor ?? 0), { currency })}
            />
          ) : null}
        </Card>

        {/* ---- Time played vs time billed ------------------------------ */}
        <View>
          <SectionHeader
            title="Time played vs time billed"
            subtitle="The gap is what your rounding and grace settings do"
          />
          <Card style={{ gap: theme.spacing.sm }}>
            <Stat
              label="Actually played"
              value={formatDuration(Number(summary?.played_seconds ?? 0))}
            />
            <Divider />
            <Stat label="Billed" value={formatDuration(Number(summary?.billed_seconds ?? 0))} />
            <Divider />
            <Stat
              label="Difference"
              value={formatDuration(
                Math.abs(
                  Number(summary?.played_seconds ?? 0) - Number(summary?.billed_seconds ?? 0),
                ),
              )}
            />
          </Card>
        </View>

        {/* ---- Trend --------------------------------------------------- */}
        <View>
          <SectionHeader title="Daily net" subtitle="Takings minus expenses" />
          <Card>
            <BarChart
              testID="daily-net-chart"
              data={reports.daily.map((day) => ({
                label: day.business_date.slice(5),
                value: Number(day.net_minor),
                detail: formatMoney(Number(day.net_minor), { currency }),
              }))}
            />
          </Card>
          <View
            style={{ flexDirection: 'row', gap: theme.spacing.md, marginTop: theme.spacing.md }}
          >
            <MiniStat label="Collected" amountMinor={collected} currency={currency} />
            <MiniStat label="Spent" amountMinor={totalExpenses} currency={currency} />
            <MiniStat
              label="Net"
              amountMinor={net}
              currency={currency}
              tone={net >= 0 ? 'success' : 'error'}
            />
          </View>
        </View>

        {/* ---- Outstanding --------------------------------------------- */}
        {outstandingTotal > 0 ? (
          <View>
            <SectionHeader title="Still owed" subtitle="Across all time, not just this period" />
            <Card style={{ gap: theme.spacing.xs }}>
              {(outstanding.data ?? []).slice(0, 8).map((row, index) => (
                <View key={row.id}>
                  {index > 0 ? <Divider /> : null}
                  <ListItem
                    title={row.customer_name ?? row.table_name ?? 'Session'}
                    subtitle={`${row.business_date} · ${row.payment_status === 'PARTIALLY_PAID' ? 'part paid' : 'unpaid'}`}
                    icon={AlertCircle}
                    trailing={
                      <MoneyValue
                        amountMinor={Number(row.outstanding_minor ?? 0)}
                        currency={currency}
                        tone="error"
                      />
                    }
                  />
                </View>
              ))}
              <Divider />
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text variant="titleSm" style={{ flex: 1 }}>
                  Total outstanding
                </Text>
                <MoneyValue
                  amountMinor={outstandingTotal}
                  currency={currency}
                  variant="titleSm"
                  tone="error"
                />
              </View>
            </Card>
          </View>
        ) : null}

        {/* ---- Tables -------------------------------------------------- */}
        <View>
          <SectionHeader title="By table" subtitle="Which tables earn" />
          <Card style={{ gap: theme.spacing.xs }}>
            {reports.tables.map((row, index) => (
              <View key={row.table_id}>
                {index > 0 ? <Divider /> : null}
                <ListItem
                  title={row.table_name}
                  subtitle={`${row.table_type_name} · ${row.sessions_count} sessions · ${formatDuration(Number(row.played_seconds))}`}
                  icon={LayoutGrid}
                  trailing={
                    <MoneyValue amountMinor={Number(row.collected_minor)} currency={currency} />
                  }
                />
              </View>
            ))}
          </Card>
        </View>

        {/* ---- Products ------------------------------------------------ */}
        <View>
          <SectionHeader title="Top sellers" subtitle="Priced as sold, not as currently listed" />
          <Card style={{ gap: theme.spacing.xs }}>
            {reports.products.length === 0 ? (
              <Text variant="bodySm" color="textMuted">
                Nothing sold in this period.
              </Text>
            ) : (
              reports.products.slice(0, 8).map((row, index) => (
                <View key={`${row.product_id}-${row.product_name}`}>
                  {index > 0 ? <Divider /> : null}
                  <ListItem
                    title={row.product_name}
                    subtitle={`${row.quantity_sold} sold`}
                    icon={Coffee}
                    trailing={
                      <MoneyValue amountMinor={Number(row.revenue_minor)} currency={currency} />
                    }
                  />
                </View>
              ))
            )}
          </Card>
        </View>

        {/* ---- Expenses ------------------------------------------------ */}
        <View>
          <SectionHeader title="Where money went" />
          <Card style={{ gap: theme.spacing.xs }}>
            {reports.expenses.length === 0 ? (
              <Text variant="bodySm" color="textMuted">
                No expenses in this period.
              </Text>
            ) : (
              reports.expenses.map((row, index) => (
                <View key={`${row.category_id}-${row.category_name}`}>
                  {index > 0 ? <Divider /> : null}
                  <ListItem
                    title={row.category_name}
                    subtitle={`${row.entries_count} ${row.entries_count === 1 ? 'entry' : 'entries'}`}
                    icon={Receipt}
                    trailing={
                      <MoneyValue amountMinor={Number(row.total_minor)} currency={currency} />
                    }
                  />
                </View>
              ))
            )}
          </Card>
        </View>
      </ScrollView>
    </Screen>
  );
}

function Stat({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <Text variant="bodySm" color="textSecondary" style={{ flex: 1 }}>
        {label}
      </Text>
      <Text variant="bodySm">{value}</Text>
    </View>
  );
}

function MiniStat({
  label,
  amountMinor,
  currency,
  tone,
}: {
  readonly label: string;
  readonly amountMinor: number;
  readonly currency: CurrencyConfig;
  readonly tone?: 'success' | 'error';
}) {
  const theme = useTheme();
  return (
    <View
      style={{
        flex: 1,
        gap: 2,
        padding: theme.spacing.md,
        borderRadius: theme.radius.md,
        backgroundColor: theme.colors.surfaceSunken,
      }}
    >
      <Text variant="caption" color="textMuted">
        {label}
      </Text>
      <MoneyValue
        amountMinor={amountMinor}
        currency={currency}
        variant="titleSm"
        {...(tone ? { tone } : {})}
      />
    </View>
  );
}
