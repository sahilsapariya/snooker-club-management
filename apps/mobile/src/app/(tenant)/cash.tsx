import { Receipt, Wallet } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';

import {
  Badge,
  Button,
  Card,
  Divider,
  ErrorState,
  ListItem,
  LoadingState,
  MoneyInput,
  MoneyValue,
  Screen,
  SectionHeader,
  Text,
  useToast,
} from '@/components/ui';
import { useAppSession } from '@/features/auth';
import { useCashClosing, useCloseTill, useDailySummary, useOpenTill } from '@/features/cash';
import { RecordExpenseSheet, useExpenses } from '@/features/expenses';
import { businessDateOf, formatDate, type CurrencyConfig, type TenantClock } from '@/lib/format';
import { useTheme } from '@/theme';

/**
 * The money view: what came in today, what went out, and whether the drawer
 * agrees.
 *
 * Every figure except the counted cash comes from the server
 * (`daily_cash_summary` and the generated columns on `cash_closings`). The one
 * number a person supplies is what they physically counted - which is the whole
 * point of a reconciliation.
 */
export default function CashScreen() {
  const theme = useTheme();
  const toast = useToast();
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

  // The club's trading day, not the device's calendar day - a club open past
  // midnight is still on yesterday's books.
  const businessDate = useMemo(() => businessDateOf(new Date().toISOString(), clock), [clock]);

  const currency: CurrencyConfig = useMemo(
    () => ({
      code: tenant?.currency_code ?? 'INR',
      minorUnits: tenant?.currency_minor_units ?? 2,
    }),
    [tenant?.currency_code, tenant?.currency_minor_units],
  );

  const summary = useDailySummary(tenantId, businessDate);
  const closing = useCashClosing(tenantId, businessDate);
  const expenses = useExpenses(tenantId);
  const openTill = useOpenTill(tenantId);
  const closeTill = useCloseTill(tenantId);

  const [openingFloat, setOpeningFloat] = useState(0);
  const [countedCash, setCountedCash] = useState(0);
  const [showExpenseSheet, setShowExpenseSheet] = useState(false);

  if (session.status !== 'tenant-user') {
    return (
      <Screen>
        <LoadingState />
      </Screen>
    );
  }

  if (summary.isPending || closing.isPending) {
    return (
      <Screen>
        <LoadingState label="Loading today" />
      </Screen>
    );
  }

  if (summary.isError) {
    return (
      <Screen>
        <ErrorState error={summary.error} onRetry={() => void summary.refetch()} />
      </Screen>
    );
  }

  const today = summary.data;
  // `useQuery` gives `undefined` before the first fetch and `null` when no
  // till exists yet; collapsing them keeps the branches below readable.
  const till = closing.data ?? null;
  const todaysExpenses = (expenses.data ?? []).filter((e) => e.expense_date === businessDate);

  const cashReceived = Number(today?.cash_received_minor ?? 0);
  const cashSpent = Number(today?.cash_expenses_minor ?? 0);
  const openingCash = till?.opening_cash_minor ?? 0;
  const expectedCash = openingCash + cashReceived - cashSpent;

  function handleOpen(): void {
    if (!tenantId) return;
    openTill.mutate(
      {
        tenantId,
        businessDate,
        openingCashMinor: openingFloat,
        openedBy: session.status === 'tenant-user' ? session.profile.id : '',
      },
      {
        onSuccess: () => toast.success('Till opened for today'),
        onError: (error) => toast.error(error, 'Could not open the till.'),
      },
    );
  }

  function handleClose(): void {
    if (!till) return;
    closeTill.mutate(
      {
        closingId: till.id,
        cashReceivedMinor: cashReceived,
        cashExpensesMinor: cashSpent,
        actualCashMinor: countedCash,
        closedBy: session.status === 'tenant-user' ? session.profile.id : '',
        notes: null,
      },
      {
        onSuccess: (row) => {
          const diff = row.difference_minor ?? 0;
          toast.success(
            diff === 0
              ? 'Till closed and balanced'
              : `Till closed with a ${diff > 0 ? 'surplus' : 'shortfall'}`,
          );
        },
        onError: (error) => toast.error(error, 'Could not close the till.'),
      },
    );
  }

  return (
    <Screen padded={false} testID="cash-screen">
      <ScrollView
        contentContainerStyle={{
          padding: theme.spacing.lg,
          gap: theme.spacing.xl,
          paddingBottom: theme.spacing['5xl'],
        }}
        refreshControl={
          <RefreshControl
            refreshing={summary.isRefetching}
            onRefresh={() => {
              void summary.refetch();
              void closing.refetch();
              void expenses.refetch();
            }}
            tintColor={theme.colors.primary}
          />
        }
      >
        <View style={{ gap: theme.spacing.xs }}>
          <Text variant="caption" color="textMuted">
            Trading day
          </Text>
          <Text variant="displayMd">{formatDate(`${businessDate}T12:00:00Z`, clock)}</Text>
        </View>

        {/* ---- Takings ------------------------------------------------- */}
        <View>
          <SectionHeader
            title="Today's takings"
            subtitle={`${today?.sessions_closed ?? 0} sessions closed`}
          />
          <Card style={{ gap: theme.spacing.sm }}>
            <Line label="Cash" amountMinor={cashReceived} currency={currency} />
            <Divider />
            <Line
              label="Card, UPI & transfer"
              amountMinor={Number(today?.non_cash_received_minor ?? 0)}
              currency={currency}
            />
            <Divider />
            <Line
              label="Total received"
              amountMinor={Number(today?.total_received_minor ?? 0)}
              currency={currency}
              strong
            />
            {Number(today?.outstanding_minor ?? 0) > 0 ? (
              <>
                <Divider />
                <Line
                  label="Still owed by customers"
                  amountMinor={Number(today?.outstanding_minor ?? 0)}
                  currency={currency}
                  tone="error"
                />
              </>
            ) : null}
          </Card>
        </View>

        {/* ---- Expenses ------------------------------------------------ */}
        <View>
          <SectionHeader
            title="Today's expenses"
            action={{ label: 'Record', onPress: () => setShowExpenseSheet(true) }}
          />
          <Card style={{ gap: theme.spacing.xs }}>
            {todaysExpenses.length === 0 ? (
              <Text variant="bodySm" color="textMuted">
                Nothing recorded today.
              </Text>
            ) : (
              todaysExpenses.map((expense, index) => (
                <View key={expense.id}>
                  {index > 0 ? <Divider /> : null}
                  <ListItem
                    title={expense.category?.name ?? 'Uncategorised'}
                    subtitle={expense.note ?? expense.payment_method}
                    icon={Receipt}
                    trailing={<MoneyValue amountMinor={expense.amount_minor} currency={currency} />}
                  />
                </View>
              ))
            )}
          </Card>
        </View>

        {/* ---- The till ------------------------------------------------ */}
        <View>
          <SectionHeader title="Cash drawer" subtitle="Only cash movements affect the drawer" />

          {till === null ? (
            <Card style={{ gap: theme.spacing.lg }}>
              <Text variant="bodySm" color="textMuted">
                The till has not been opened for today. Count the float you are starting with.
              </Text>
              <MoneyInput
                label="Opening float"
                value={openingFloat}
                onChange={setOpeningFloat}
                currency={currency}
                testID="opening-float"
              />
              <Button
                label="Open till"
                onPress={handleOpen}
                loading={openTill.isPending}
                fullWidth
              />
            </Card>
          ) : (
            <Card style={{ gap: theme.spacing.sm }}>
              <Line label="Opening float" amountMinor={openingCash} currency={currency} />
              <Divider />
              <Line label="Cash taken" amountMinor={cashReceived} currency={currency} />
              <Divider />
              <Line label="Cash spent" amountMinor={-cashSpent} currency={currency} />
              <Divider />
              <Line
                label="Expected in drawer"
                amountMinor={expectedCash}
                currency={currency}
                strong
              />

              {till.status === 'CLOSED' ? (
                <>
                  <Divider />
                  <Line
                    label="Counted"
                    amountMinor={till.actual_cash_minor ?? 0}
                    currency={currency}
                  />
                  <Divider />
                  <Line
                    label={(till.difference_minor ?? 0) < 0 ? 'Shortfall' : 'Surplus'}
                    amountMinor={till.difference_minor ?? 0}
                    currency={currency}
                    strong
                    tone={(till.difference_minor ?? 0) === 0 ? 'success' : 'error'}
                  />
                  <View style={{ marginTop: theme.spacing.sm }}>
                    <Badge label="Closed" tone="neutral" />
                  </View>
                </>
              ) : (
                <View style={{ gap: theme.spacing.lg, marginTop: theme.spacing.md }}>
                  <MoneyInput
                    label="Count the drawer"
                    value={countedCash}
                    onChange={setCountedCash}
                    currency={currency}
                    hint="Enter what is physically there. The difference is calculated for you."
                    testID="counted-cash"
                  />
                  {countedCash !== expectedCash ? (
                    <Text variant="bodySm" color={countedCash < expectedCash ? 'error' : 'warning'}>
                      {countedCash < expectedCash ? 'Short by ' : 'Over by '}
                      {Math.abs(countedCash - expectedCash) / 10 ** currency.minorUnits}
                    </Text>
                  ) : null}
                  <Button
                    label="Close till for today"
                    onPress={handleClose}
                    loading={closeTill.isPending}
                    fullWidth
                    icon={Wallet}
                  />
                </View>
              )}
            </Card>
          )}
        </View>
      </ScrollView>

      <RecordExpenseSheet
        visible={showExpenseSheet}
        onClose={() => setShowExpenseSheet(false)}
        tenantId={session.tenant.id}
        userId={session.profile.id}
        currency={currency}
        defaultDate={businessDate}
      />
    </Screen>
  );
}

function Line({
  label,
  amountMinor,
  currency,
  strong = false,
  tone,
}: {
  readonly label: string;
  readonly amountMinor: number;
  readonly currency: CurrencyConfig;
  readonly strong?: boolean;
  readonly tone?: 'error' | 'success';
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <Text variant={strong ? 'titleSm' : 'bodySm'} color="textSecondary" style={{ flex: 1 }}>
        {label}
      </Text>
      <MoneyValue
        amountMinor={amountMinor}
        currency={currency}
        variant={strong ? 'titleSm' : 'bodySm'}
        {...(tone ? { tone } : {})}
      />
    </View>
  );
}
