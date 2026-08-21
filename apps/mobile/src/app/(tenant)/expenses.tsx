import { Receipt, Trash2 } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';

import {
  Badge,
  Button,
  Card,
  Divider,
  EmptyState,
  ErrorState,
  IconButton,
  Input,
  ListItem,
  LoadingState,
  MoneyInput,
  MoneyValue,
  Screen,
  SectionHeader,
  Select,
  Sheet,
  Text,
  useToast,
} from '@/components/ui';
import { useAppSession } from '@/features/auth';
import {
  useDeleteExpense,
  useExpenseCategories,
  useExpenses,
  useUpdateExpense,
  type ExpenseWithCategory,
} from '@/features/expenses';
import { businessDateOf, formatDate, type CurrencyConfig, type TenantClock } from '@/lib/format';
import { useTheme } from '@/theme';
import type { Database } from '@/types/database.types';

type PaymentMethod = Database['public']['Enums']['payment_method'];

const METHODS: readonly { value: PaymentMethod; label: string }[] = [
  { value: 'CASH', label: 'Cash' },
  { value: 'UPI', label: 'UPI' },
  { value: 'CARD', label: 'Card' },
  { value: 'BANK_TRANSFER', label: 'Transfer' },
];

type Preset = 'today' | 'week' | 'month' | 'all';

/**
 * Money out, over time.
 *
 * The Cash screen answers "does the drawer balance today". This one answers
 * "where is the money going", which is a different question needing a different
 * shape: a range rather than a day, totals rather than a reconciliation, and
 * the ability to correct a mistake recorded last Tuesday.
 *
 * Editing and deleting are governed by RLS, not by this screen: the author of
 * an expense or the club's owner may change it, and nobody else. A receptionist
 * tapping someone else's row simply has their write refused.
 */
export default function ExpensesScreen() {
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

  const currency: CurrencyConfig = useMemo(
    () => ({
      code: tenant?.currency_code ?? 'INR',
      minorUnits: tenant?.currency_minor_units ?? 2,
    }),
    [tenant?.currency_code, tenant?.currency_minor_units],
  );

  const [preset, setPreset] = useState<Preset>('month');
  const today = useMemo(() => businessDateOf(new Date().toISOString(), clock), [clock]);
  const range = useMemo(() => rangeFor(preset, today), [preset, today]);

  const expenses = useExpenses(tenantId, range);
  const categories = useExpenseCategories(tenantId);
  const removeExpense = useDeleteExpense(tenantId);
  const [editing, setEditing] = useState<ExpenseWithCategory | null>(null);

  const { total, cashTotal, byCategory } = useMemo(
    () => summarise(expenses.data ?? []),
    [expenses.data],
  );

  if (session.status !== 'tenant-user') {
    return (
      <Screen>
        <LoadingState />
      </Screen>
    );
  }

  return (
    <Screen padded={false} testID="expenses-screen">
      <ScrollView
        contentContainerStyle={{
          padding: theme.spacing.lg,
          gap: theme.spacing.xl,
          paddingBottom: theme.spacing['5xl'],
        }}
        refreshControl={
          <RefreshControl
            refreshing={expenses.isRefetching}
            onRefresh={() => void expenses.refetch()}
          />
        }
      >
        {expenses.isError ? (
          <ErrorState error={expenses.error} onRetry={() => void expenses.refetch()} />
        ) : null}

        <Select
          label="Period"
          value={preset}
          onChange={setPreset}
          options={[
            { value: 'today', label: 'Today' },
            { value: 'week', label: 'Last 7 days' },
            { value: 'month', label: 'Last 30 days' },
            { value: 'all', label: 'Everything' },
          ]}
          testID="expense-period"
        />

        <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
          <Card style={{ flex: 1, gap: theme.spacing.xs }}>
            <Text variant="caption" color="textMuted">
              Total out
            </Text>
            <MoneyValue amountMinor={total} currency={currency} variant="titleMd" />
          </Card>
          <Card style={{ flex: 1, gap: theme.spacing.xs }}>
            <Text variant="caption" color="textMuted">
              From the drawer
            </Text>
            <MoneyValue amountMinor={cashTotal} currency={currency} variant="titleMd" />
          </Card>
        </View>

        {byCategory.length > 0 ? (
          <View>
            <SectionHeader title="By category" />
            <Card style={{ gap: theme.spacing.sm }}>
              {byCategory.map(([name, amount], index) => (
                <View key={name}>
                  {index > 0 ? <Divider /> : null}
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      paddingVertical: theme.spacing.xs,
                    }}
                  >
                    <Text variant="bodySm" style={{ flex: 1 }}>
                      {name}
                    </Text>
                    <MoneyValue amountMinor={amount} currency={currency} variant="bodySm" />
                  </View>
                </View>
              ))}
            </Card>
          </View>
        ) : null}

        <View>
          <SectionHeader
            title="Every expense"
            subtitle={`${(expenses.data ?? []).length} recorded in this period`}
          />

          {expenses.isPending ? <LoadingState label="Loading expenses" /> : null}

          {!expenses.isPending && (expenses.data ?? []).length === 0 ? (
            <EmptyState
              icon={Receipt}
              title="Nothing recorded"
              description="Expenses show up here as staff record them on the Cash screen."
            />
          ) : (
            <Card style={{ gap: theme.spacing.xs }}>
              {(expenses.data ?? []).map((expense, index) => (
                <View key={expense.id}>
                  {index > 0 ? <Divider /> : null}
                  <ListItem
                    title={expense.category?.name ?? 'Uncategorised'}
                    subtitle={[formatDate(`${expense.expense_date}T12:00:00Z`, clock), expense.note]
                      .filter(Boolean)
                      .join(' · ')}
                    onPress={() => setEditing(expense)}
                    testID={`expense-row-${expense.id}`}
                    trailing={
                      <View
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: theme.spacing.sm,
                        }}
                      >
                        {expense.payment_method === 'CASH' ? null : (
                          <Badge label={methodLabel(expense.payment_method)} tone="neutral" />
                        )}
                        <MoneyValue amountMinor={expense.amount_minor} currency={currency} />
                        <IconButton
                          icon={Trash2}
                          tone="danger"
                          accessibilityLabel={`Delete the ${expense.category?.name ?? 'uncategorised'} expense`}
                          onPress={() =>
                            removeExpense.mutate(expense.id, {
                              onSuccess: () => toast.show('Expense deleted', 'info'),
                              onError: (error) =>
                                toast.error(
                                  error,
                                  'Could not delete that. Only the person who recorded it, or the owner, can.',
                                ),
                            })
                          }
                        />
                      </View>
                    }
                  />
                </View>
              ))}
            </Card>
          )}
        </View>
      </ScrollView>

      <EditExpenseSheet
        key={editing?.id ?? 'none'}
        expense={editing}
        onClose={() => setEditing(null)}
        tenantId={tenantId}
        currency={currency}
        categories={(categories.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
      />
    </Screen>
  );
}

function EditExpenseSheet({
  expense,
  onClose,
  tenantId,
  currency,
  categories,
}: {
  readonly expense: ExpenseWithCategory | null;
  readonly onClose: () => void;
  readonly tenantId: string | null;
  readonly currency: CurrencyConfig;
  readonly categories: readonly { value: string; label: string }[];
}) {
  const theme = useTheme();
  const toast = useToast();
  const save = useUpdateExpense(tenantId);

  const [amountMinor, setAmountMinor] = useState(expense?.amount_minor ?? 0);
  const [categoryId, setCategoryId] = useState<string | null>(expense?.category_id ?? null);
  const [method, setMethod] = useState<PaymentMethod>(expense?.payment_method ?? 'CASH');
  const [note, setNote] = useState(expense?.note ?? '');
  const [date, setDate] = useState(expense?.expense_date ?? '');

  if (!expense) return null;

  const dateValid = /^\d{4}-\d{2}-\d{2}$/.test(date);
  const canSave = amountMinor > 0 && dateValid;

  return (
    <Sheet
      visible
      onClose={onClose}
      title="Correct this expense"
      subtitle="Only the person who recorded it, or the club owner, can change it"
      testID="edit-expense-sheet"
    >
      <View style={{ gap: theme.spacing.lg }}>
        <MoneyInput
          label="Amount"
          value={amountMinor}
          onChange={setAmountMinor}
          currency={currency}
          testID="edit-expense-amount"
        />

        <Select
          label="Category"
          value={categoryId}
          onChange={setCategoryId}
          options={[...categories]}
        />

        <Select label="Paid by" value={method} onChange={setMethod} options={[...METHODS]} />

        <Input
          label="Date"
          value={date}
          onChangeText={setDate}
          placeholder="YYYY-MM-DD"
          autoCapitalize="none"
          hint="Moving an expense to another day changes both days' cash position."
          error={dateValid ? undefined : 'Use the form YYYY-MM-DD.'}
        />

        <Input label="Note" value={note} onChangeText={setNote} multiline />

        <Button
          label="Save changes"
          fullWidth
          disabled={!canSave}
          loading={save.isPending}
          testID="save-expense"
          onPress={() =>
            save.mutate(
              {
                expenseId: expense.id,
                previousDate: expense.expense_date,
                amountMinor,
                categoryId,
                paymentMethod: method,
                expenseDate: date,
                note: note.trim() === '' ? null : note.trim(),
              },
              {
                onSuccess: () => {
                  toast.success('Expense corrected');
                  onClose();
                },
                onError: (error) =>
                  toast.error(
                    error,
                    'Could not save that. Only the person who recorded it, or the owner, can.',
                  ),
              },
            )
          }
        />
      </View>
    </Sheet>
  );
}

function methodLabel(method: PaymentMethod): string {
  return METHODS.find((m) => m.value === method)?.label ?? method;
}

/**
 * Ranges are computed from the club's *business* date, not the device's
 * calendar date — a club whose trading day ends at 02:00 is still on yesterday's
 * books at 01:00.
 */
function rangeFor(preset: Preset, today: string): { from?: string; to?: string } {
  if (preset === 'all') return {};
  if (preset === 'today') return { from: today, to: today };

  const days = preset === 'week' ? 6 : 29;
  const from = new Date(`${today}T12:00:00Z`);
  from.setUTCDate(from.getUTCDate() - days);
  return { from: from.toISOString().slice(0, 10), to: today };
}

function summarise(expenses: readonly ExpenseWithCategory[]) {
  let total = 0;
  let cashTotal = 0;
  const categories = new Map<string, number>();

  for (const expense of expenses) {
    total += expense.amount_minor;
    if (expense.payment_method === 'CASH') cashTotal += expense.amount_minor;

    const name = expense.category?.name ?? 'Uncategorised';
    categories.set(name, (categories.get(name) ?? 0) + expense.amount_minor);
  }

  return {
    total,
    cashTotal,
    byCategory: [...categories.entries()].sort((a, b) => b[1] - a[1]),
  };
}
