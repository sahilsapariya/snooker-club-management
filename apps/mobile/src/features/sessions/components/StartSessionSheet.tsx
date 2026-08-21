import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { Button, Input, Select, Sheet, Text, useToast } from '@/components/ui';
import type { ClubTableOverview } from '@/features/tables';
import { formatMoney, type CurrencyConfig } from '@/lib/format';
import { useTheme } from '@/theme';

import { useStartSession } from '../hooks/use-sessions';

/** Durations a club actually sells. `null` is an open-ended session. */
const DURATION_OPTIONS: readonly { value: number; label: string }[] = [
  { value: 30, label: '30 min' },
  { value: 60, label: '1 hour' },
  { value: 90, label: '1½ hours' },
  { value: 120, label: '2 hours' },
];

const OPEN_ENDED = -1;

export interface StartSessionSheetProps {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly table: ClubTableOverview | null;
  readonly tenantId: string;
  readonly userId: string;
  readonly currency: CurrencyConfig;
}

/**
 * Starts play on a table.
 *
 * The booked duration is optional. Choosing one only decides when the session
 * is *flagged* as time-completed - it never causes the session to end, and an
 * open-ended session simply never raises that flag.
 */
export function StartSessionSheet({
  visible,
  onClose,
  table,
  tenantId,
  userId,
  currency,
}: StartSessionSheetProps) {
  const theme = useTheme();
  const toast = useToast();
  const startSession = useStartSession(tenantId);

  const [duration, setDuration] = useState<number>(60);
  const [customerName, setCustomerName] = useState('');

  // Reset between openings so the previous table's choices do not leak.
  useEffect(() => {
    if (visible) {
      setDuration(60);
      setCustomerName('');
    }
  }, [visible]);

  const canStart = table !== null && table.id !== null && table.table_type_id !== null;

  function handleStart(): void {
    if (!canStart || !table?.id || !table.table_type_id) return;

    startSession.mutate(
      {
        tenantId,
        tableId: table.id,
        tableTypeId: table.table_type_id,
        startedBy: userId,
        plannedDurationMinutes: duration === OPEN_ENDED ? null : duration,
        customerName: customerName.trim() === '' ? null : customerName.trim(),
      },
      {
        onSuccess: () => {
          toast.success(`${table.name ?? 'Table'} is now in play`);
          onClose();
        },
        onError: (error) => toast.error(error, 'Could not start the session.'),
      },
    );
  }

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={`Start ${table?.name ?? 'session'}`}
      {...(table?.table_type_name ? { subtitle: table.table_type_name } : {})}
      testID="start-session-sheet"
      footer={
        <Button
          label="Start session"
          size="lg"
          fullWidth
          loading={startSession.isPending}
          disabled={!canStart}
          onPress={handleStart}
          testID="confirm-start-session"
        />
      }
    >
      <View style={{ gap: theme.spacing.xl }}>
        <Select
          label="Booked time"
          value={duration}
          onChange={setDuration}
          options={[
            ...DURATION_OPTIONS,
            { value: OPEN_ENDED, label: 'Open', hint: 'No booked end' },
          ]}
        />

        <Input
          label="Customer name (optional)"
          value={customerName}
          onChangeText={setCustomerName}
          placeholder="Walk-in"
          autoCapitalize="words"
          returnKeyType="done"
        />

        <View
          style={{
            backgroundColor: theme.colors.surfaceSunken,
            borderRadius: theme.radius.md,
            padding: theme.spacing.md,
            gap: theme.spacing.xs,
          }}
        >
          <Text variant="label" color="textSecondary">
            How this is billed
          </Text>
          <Text variant="caption" color="textMuted">
            {duration === OPEN_ENDED
              ? 'The clock runs until you close the session. Pricing is applied when you close it.'
              : `The table is flagged after ${duration} minutes so you know the booked time is up. The session keeps running until you close it — overtime is priced by this club's rules.`}
          </Text>
          <Text variant="caption" color="textMuted">
            Price is calculated at close using the rate in effect right now
            {currency.code === 'INR' ? '' : ` (${currency.code})`}.
          </Text>
        </View>

        {table?.status === 'MAINTENANCE' ? (
          <Text variant="bodySm" color="warning">
            This table is marked for maintenance. Starting a session anyway will leave that flag in
            place.
          </Text>
        ) : null}
      </View>
    </Sheet>
  );
}

/** Small helper so callers can preview a rate without importing the formatter. */
export function describeRate(rateMinor: number, currency: CurrencyConfig): string {
  return formatMoney(rateMinor, { currency });
}
