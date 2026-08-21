import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { Button, Input, MoneyInput, Select, Sheet, Text, useToast } from '@/components/ui';
import type { CurrencyConfig } from '@/lib/format';
import { useTheme } from '@/theme';
import type { Database } from '@/types/database.types';

import { useCreateExpense, useExpenseCategories } from '../hooks/use-expenses';

type PaymentMethod = Database['public']['Enums']['payment_method'];

const METHODS: readonly { value: PaymentMethod; label: string }[] = [
  { value: 'CASH', label: 'Cash' },
  { value: 'UPI', label: 'UPI' },
  { value: 'CARD', label: 'Card' },
  { value: 'BANK_TRANSFER', label: 'Transfer' },
];

export interface RecordExpenseSheetProps {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly tenantId: string;
  readonly userId: string;
  readonly currency: CurrencyConfig;
  /** The club's current trading day, so the expense lands on the right books. */
  readonly defaultDate: string;
}

/**
 * Records money going out.
 *
 * The payment method matters more than it looks: only cash expenses come out of
 * the drawer, so choosing "Card" here keeps the till reconciliation correct.
 */
export function RecordExpenseSheet({
  visible,
  onClose,
  tenantId,
  userId,
  currency,
  defaultDate,
}: RecordExpenseSheetProps) {
  const theme = useTheme();
  const toast = useToast();
  const { data: categories } = useExpenseCategories(visible ? tenantId : null);
  const createExpense = useCreateExpense(tenantId);

  const [amountMinor, setAmountMinor] = useState(0);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [note, setNote] = useState('');

  useEffect(() => {
    if (visible) {
      setAmountMinor(0);
      setCategoryId(null);
      setMethod('CASH');
      setNote('');
    }
  }, [visible]);

  const canSave = amountMinor > 0;

  function handleSave(): void {
    createExpense.mutate(
      {
        tenantId,
        categoryId,
        amountMinor,
        expenseDate: defaultDate,
        paymentMethod: method,
        note: note.trim() === '' ? null : note.trim(),
        createdBy: userId,
      },
      {
        onSuccess: () => {
          toast.success('Expense recorded');
          onClose();
        },
        onError: (error) => toast.error(error, 'Could not record the expense.'),
      },
    );
  }

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Record an expense"
      subtitle={defaultDate}
      testID="record-expense-sheet"
      footer={
        <Button
          label="Save expense"
          size="lg"
          fullWidth
          disabled={!canSave}
          loading={createExpense.isPending}
          onPress={handleSave}
          testID="save-expense"
        />
      }
    >
      <View style={{ gap: theme.spacing.xl }}>
        <MoneyInput
          label="Amount"
          value={amountMinor}
          onChange={setAmountMinor}
          currency={currency}
          autoFocus
          testID="expense-amount"
        />

        <Select
          label="Category"
          value={categoryId}
          onChange={setCategoryId}
          options={(categories ?? []).map((c) => ({ value: c.id, label: c.name }))}
        />

        <Select label="Paid by" value={method} onChange={setMethod} options={[...METHODS]} />

        <Input
          label="Note (optional)"
          value={note}
          onChangeText={setNote}
          placeholder="What was this for?"
          returnKeyType="done"
        />

        {method === 'CASH' ? (
          <Text variant="caption" color="textMuted">
            Cash expenses come out of the drawer and are subtracted from the expected till total.
          </Text>
        ) : (
          <Text variant="caption" color="textMuted">
            Non-cash expenses do not affect the drawer, so the till reconciliation ignores them.
          </Text>
        )}
      </View>
    </Sheet>
  );
}
