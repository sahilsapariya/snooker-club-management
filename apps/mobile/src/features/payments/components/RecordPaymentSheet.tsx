import { useState } from 'react';
import { View } from 'react-native';

import { Button, MoneyInput, MoneyValue, Select, Sheet, Text, useToast } from '@/components/ui';
import type { CurrencyConfig } from '@/lib/format';
import { useTheme } from '@/theme';

import { useRecordPayment } from '../hooks/use-payments';
import type { OutstandingSession, PaymentMethod } from '../api/payments.api';

const METHODS: readonly { value: PaymentMethod; label: string }[] = [
  { value: 'CASH', label: 'Cash' },
  { value: 'UPI', label: 'UPI' },
  { value: 'CARD', label: 'Card' },
  { value: 'BANK_TRANSFER', label: 'Transfer' },
];

export interface RecordPaymentSheetProps {
  readonly debt: OutstandingSession | null;
  readonly onClose: () => void;
  readonly tenantId: string;
  readonly userId: string;
  readonly currency: CurrencyConfig;
}

/**
 * Taking money against a bill that was left owing.
 *
 * Defaults to settling the balance in full, because that is what almost always
 * happens - somebody comes back and pays. A part payment is possible, but it
 * takes a deliberate edit rather than being the shape of the form.
 *
 * The amount cannot exceed what is owed, and the database enforces that rather
 * than this screen: if a customer hands over more, the difference is change,
 * not a larger payment.
 */
export function RecordPaymentSheet({
  debt,
  onClose,
  tenantId,
  userId,
  currency,
}: RecordPaymentSheetProps) {
  const theme = useTheme();
  const toast = useToast();
  const record = useRecordPayment(tenantId);

  const outstanding = Number(debt?.outstanding_minor ?? 0);
  const [amountMinor, setAmountMinor] = useState(outstanding);
  const [method, setMethod] = useState<PaymentMethod>('CASH');

  if (!debt) return null;

  const overpaying = amountMinor > outstanding;
  const canSubmit = amountMinor > 0 && !overpaying;
  const settlesIt = amountMinor === outstanding;

  return (
    <Sheet
      visible
      onClose={onClose}
      title="Record a payment"
      subtitle={[debt.table_name, debt.customer_name ?? 'Walk-in'].filter(Boolean).join(' · ')}
      testID="record-payment-sheet"
    >
      <View style={{ gap: theme.spacing.lg }}>
        <View
          style={{
            backgroundColor: theme.colors.surfaceSunken,
            borderRadius: theme.radius.lg,
            padding: theme.spacing.lg,
            gap: theme.spacing.xs,
          }}
        >
          <Text variant="caption" color="textMuted">
            Still owed
          </Text>
          <MoneyValue amountMinor={outstanding} currency={currency} variant="titleLg" />
          <Text variant="caption" color="textMuted">
            Billed {formatMoneyPlain(Number(debt.total_amount_minor ?? 0), currency)} · already paid{' '}
            {formatMoneyPlain(Number(debt.paid_amount_minor ?? 0), currency)}
          </Text>
        </View>

        <MoneyInput
          label="Amount received"
          value={amountMinor}
          onChange={setAmountMinor}
          currency={currency}
          hint="Defaults to the full balance."
          {...(overpaying
            ? { error: 'That is more than is owed. Give the difference as change.' }
            : {})}
          testID="payment-amount"
        />

        <Select label="Paid by" value={method} onChange={setMethod} options={[...METHODS]} />

        <Button
          label={settlesIt ? 'Settle this bill' : 'Record part payment'}
          size="lg"
          fullWidth
          disabled={!canSubmit}
          loading={record.isPending}
          testID="submit-payment"
          onPress={() =>
            record.mutate(
              {
                sessionId: debt.id as string,
                amountMinor,
                method,
                note: null,
                receivedBy: userId,
              },
              {
                onSuccess: () => {
                  toast.success(settlesIt ? 'Bill settled' : 'Part payment recorded');
                  onClose();
                },
                onError: (error) => toast.error(error, 'Could not record that payment.'),
              },
            )
          }
        />

        <Text variant="caption" color="textMuted">
          Cash lands in today&apos;s drawer, not the day the session was played. The trading day is
          set by the server.
        </Text>
      </View>
    </Sheet>
  );
}

function formatMoneyPlain(amountMinor: number, currency: CurrencyConfig): string {
  return (amountMinor / 10 ** currency.minorUnits).toFixed(currency.minorUnits);
}
