import { HandCoins, Trash2 } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';

import {
  Badge,
  Card,
  Divider,
  EmptyState,
  ErrorState,
  IconButton,
  ListItem,
  LoadingState,
  MoneyValue,
  Screen,
  SectionHeader,
  Text,
  useToast,
} from '@/components/ui';
import { useAppSession } from '@/features/auth';
import {
  RecordPaymentSheet,
  useDeletePayment,
  useOutstandingSessions,
  useSessionPayments,
  type OutstandingSession,
} from '@/features/payments';
import { businessDateOf, formatDate, type CurrencyConfig, type TenantClock } from '@/lib/format';
import { useTheme } from '@/theme';

/**
 * Who still owes the club money.
 *
 * Oldest debt first, because that is the one most likely to be forgotten and
 * the one worth chasing. Age is shown in days rather than as a date: "11 days"
 * prompts an action in a way that "10 August" does not.
 *
 * A payment recorded here lands in *today's* drawer, not the day the session
 * was played. That is the whole reason payments are rows — see
 * docs/database.md. The old shape would have credited the cash to a day whose
 * till was counted and signed off a week ago.
 */
export default function DebtsScreen() {
  const theme = useTheme();
  const session = useAppSession();

  const tenant = session.status === 'tenant-user' ? session.tenant : null;
  const tenantId = tenant?.id ?? null;

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

  const debts = useOutstandingSessions(tenantId);
  const [settling, setSettling] = useState<OutstandingSession | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const today = useMemo(() => businessDateOf(new Date().toISOString(), clock), [clock]);
  const totalOwed = useMemo(
    () => (debts.data ?? []).reduce((sum, d) => sum + Number(d.outstanding_minor ?? 0), 0),
    [debts.data],
  );

  if (session.status !== 'tenant-user') {
    return (
      <Screen>
        <LoadingState />
      </Screen>
    );
  }

  const list = debts.data ?? [];

  return (
    <Screen padded={false} testID="debts-screen">
      <ScrollView
        contentContainerStyle={{
          padding: theme.spacing.lg,
          gap: theme.spacing.xl,
          paddingBottom: theme.spacing['5xl'],
        }}
        refreshControl={
          <RefreshControl refreshing={debts.isRefetching} onRefresh={() => void debts.refetch()} />
        }
      >
        {debts.isError ? (
          <ErrorState error={debts.error} onRetry={() => void debts.refetch()} />
        ) : null}
        {debts.isPending ? <LoadingState label="Loading balances" /> : null}

        {!debts.isPending && list.length === 0 ? (
          <EmptyState
            icon={HandCoins}
            title="Nothing outstanding"
            description={`Every closed session at ${session.tenant.name} has been paid for.`}
          />
        ) : null}

        {list.length > 0 ? (
          <>
            <Card style={{ gap: theme.spacing.xs, alignItems: 'center' }}>
              <Text variant="caption" color="textMuted">
                Owed to the club
              </Text>
              <MoneyValue amountMinor={totalOwed} currency={currency} variant="displayMd" />
              <Text variant="caption" color="textMuted">
                across {list.length} {list.length === 1 ? 'bill' : 'bills'}
              </Text>
            </Card>

            <View>
              <SectionHeader title="Oldest first" subtitle="Tap a bill to take a payment" />
              <Card style={{ gap: theme.spacing.xs }}>
                {list.map((debt, index) => (
                  <View key={debt.id as string}>
                    {index > 0 ? <Divider /> : null}
                    <DebtRow
                      debt={debt}
                      today={today}
                      clock={clock}
                      currency={currency}
                      onSettle={() => setSettling(debt)}
                      onToggleHistory={() =>
                        setExpanded((current) => (current === debt.id ? null : (debt.id as string)))
                      }
                      expanded={expanded === debt.id}
                      tenantId={tenantId}
                      canRemovePayments={session.role === 'OWNER'}
                      currencyConfig={currency}
                    />
                  </View>
                ))}
              </Card>
            </View>
          </>
        ) : null}
      </ScrollView>

      <RecordPaymentSheet
        debt={settling}
        onClose={() => setSettling(null)}
        tenantId={session.tenant.id}
        userId={session.profile.id}
        currency={currency}
      />
    </Screen>
  );
}

function DebtRow({
  debt,
  today,
  clock,
  currency,
  onSettle,
  onToggleHistory,
  expanded,
  tenantId,
  canRemovePayments,
  currencyConfig,
}: {
  readonly debt: OutstandingSession;
  readonly today: string;
  readonly clock: TenantClock;
  readonly currency: CurrencyConfig;
  readonly onSettle: () => void;
  readonly onToggleHistory: () => void;
  readonly expanded: boolean;
  readonly tenantId: string | null;
  readonly canRemovePayments: boolean;
  readonly currencyConfig: CurrencyConfig;
}) {
  const theme = useTheme();
  const toast = useToast();
  const payments = useSessionPayments(tenantId, expanded ? (debt.id as string) : null);
  const removePayment = useDeletePayment(tenantId);

  const ageDays = daysBetween(debt.business_date as string, today);
  const partPaid = Number(debt.paid_amount_minor ?? 0) > 0;

  return (
    <View>
      <ListItem
        title={[debt.customer_name, debt.table_name].filter(Boolean).join(' · ') || 'Walk-in'}
        subtitle={`${formatDate(`${debt.business_date as string}T12:00:00Z`, clock)} · ${ageLabel(ageDays)}`}
        onPress={onSettle}
        testID={`debt-row-${debt.id as string}`}
        trailing={
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
            {partPaid ? <Badge label="Part paid" tone="warning" /> : null}
            {ageDays >= 14 ? <Badge label="Overdue" tone="error" /> : null}
            <MoneyValue
              amountMinor={Number(debt.outstanding_minor ?? 0)}
              currency={currency}
              variant="titleSm"
            />
          </View>
        }
      />

      {partPaid ? (
        <Text
          variant="caption"
          color="textMuted"
          onPress={onToggleHistory}
          style={{ paddingLeft: theme.spacing.md, paddingBottom: theme.spacing.sm }}
        >
          {expanded ? 'Hide payments' : 'Show payments already made'}
        </Text>
      ) : null}

      {expanded ? (
        <View
          style={{
            paddingLeft: theme.spacing.md,
            gap: theme.spacing.xs,
            paddingBottom: theme.spacing.sm,
          }}
        >
          {(payments.data ?? []).map((payment) => (
            <View
              key={payment.id}
              style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}
            >
              <Text variant="caption" color="textMuted" style={{ flex: 1 }}>
                {formatDate(`${payment.business_date}T12:00:00Z`, clock)} ·{' '}
                {payment.method.toLowerCase()}
              </Text>
              <MoneyValue
                amountMinor={payment.amount_minor}
                currency={currencyConfig}
                variant="bodySm"
              />
              {canRemovePayments ? (
                <IconButton
                  icon={Trash2}
                  tone="danger"
                  accessibilityLabel="Remove this payment"
                  onPress={() =>
                    removePayment.mutate(payment.id, {
                      onSuccess: () => toast.show('Payment removed', 'info'),
                      onError: (error) =>
                        toast.error(error, 'Could not remove that. Only the owner can.'),
                    })
                  }
                />
              ) : null}
            </View>
          ))}
          {payments.isPending ? (
            <Text variant="caption" color="textMuted">
              Loading…
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function daysBetween(from: string, to: string): number {
  const start = Date.parse(`${from}T12:00:00Z`);
  const end = Date.parse(`${to}T12:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.max(0, Math.round((end - start) / 86_400_000));
}

/** Age prompts an action in a way a date does not. */
function ageLabel(days: number): string {
  if (days === 0) return 'today';
  if (days === 1) return '1 day';
  return `${days} days`;
}
