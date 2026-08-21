import { Lock } from 'lucide-react-native';
import { useState } from 'react';
import { ScrollView, Switch, View } from 'react-native';

import {
  Button,
  Card,
  Divider,
  EmptyState,
  Input,
  LoadingState,
  MoneyInput,
  Screen,
  SectionHeader,
  Select,
  Text,
  useToast,
} from '@/components/ui';
import { useAppSession } from '@/features/auth';
import { useUpdateBillingSettings, type BillingSettings } from '@/features/billing';
import type { CurrencyConfig } from '@/lib/format';
import { useTheme } from '@/theme';
import type { Database } from '@/types/database.types';

type Enums = Database['public']['Enums'];

const TIME_MODES: readonly {
  value: Enums['time_calculation_mode'];
  label: string;
  hint: string;
}[] = [
  { value: 'PER_MINUTE', label: 'Per minute', hint: 'Charge for exactly the minutes played' },
  { value: 'PER_HOUR', label: 'Per hour', hint: 'Price is quoted hourly, billed by the minute' },
  {
    value: 'FIXED_INCREMENT',
    label: 'In blocks',
    hint: 'Round up to whole blocks — the usual choice',
  },
  { value: 'CUSTOM_SLABS', label: 'Slabs', hint: 'A price ladder, configured in SQL for now' },
];

const ROUNDING_MODES: readonly { value: Enums['rounding_mode']; label: string; hint: string }[] = [
  { value: 'EXACT', label: 'No rounding', hint: 'Bill the exact time' },
  { value: 'ROUND_UP', label: 'Round up', hint: 'Always in the club’s favour' },
  { value: 'ROUND_DOWN', label: 'Round down', hint: 'Always in the customer’s favour' },
  { value: 'NEAREST', label: 'Nearest', hint: 'Up or down, whichever is closer' },
];

const OVERTIME_MODES: readonly { value: Enums['overtime_mode']; label: string; hint: string }[] = [
  { value: 'SAME_RATE', label: 'Same rate', hint: 'Overtime costs the same as booked time' },
  { value: 'OVERTIME_RATE', label: 'Higher rate', hint: 'A separate, usually higher, rate' },
  { value: 'INCREMENT_BLOCK', label: 'Whole blocks', hint: 'A flat charge per block started' },
  { value: 'FREE', label: 'Free', hint: 'Overtime is not charged at all' },
];

/**
 * How this club turns time into money.
 *
 * Owner-only, and the database agrees: since migration 0015 the write policies
 * on `tenant_billing_settings` require `app.is_tenant_owner(tenant_id)`, which
 * means even a platform administrator cannot change them. What a club charges
 * is the club's decision.
 *
 * Two things this screen deliberately does not do:
 *
 *   It does not re-price anything. Every session carries the pricing snapshot
 *   taken when it started, so changing a rule today never rewrites yesterday's
 *   bill — and never rewrites the bill of a session already running.
 *
 *   It does not touch actual duration. These settings decide *billable* time
 *   only. Real elapsed time is a generated column that no rule here can reach.
 */
export default function BillingScreen() {
  const session = useAppSession();

  if (session.status !== 'tenant-user') {
    return (
      <Screen>
        <LoadingState />
      </Screen>
    );
  }

  if (session.role !== 'OWNER') {
    return (
      <Screen>
        <EmptyState
          icon={Lock}
          title="Owner only"
          description="Billing rules decide what every customer is charged. Only the club owner can change them."
        />
      </Screen>
    );
  }

  if (!session.billingSettings) {
    return (
      <Screen>
        <LoadingState label="Loading billing rules" />
      </Screen>
    );
  }

  return (
    <BillingForm
      key={session.tenant.id}
      tenantId={session.tenant.id}
      settings={session.billingSettings}
      currency={{
        code: session.tenant.currency_code,
        minorUnits: session.tenant.currency_minor_units,
      }}
    />
  );
}

function BillingForm({
  tenantId,
  settings,
  currency,
}: {
  readonly tenantId: string;
  readonly settings: BillingSettings;
  readonly currency: CurrencyConfig;
}) {
  const theme = useTheme();
  const toast = useToast();
  const save = useUpdateBillingSettings(tenantId);

  const [timeMode, setTimeMode] = useState(settings.time_calculation_mode);
  const [increment, setIncrement] = useState(String(settings.billing_increment_minutes));
  const [minimum, setMinimum] = useState(String(settings.minimum_billable_minutes));
  const [roundingMode, setRoundingMode] = useState(settings.rounding_mode);
  const [roundingIncrement, setRoundingIncrement] = useState(
    String(settings.rounding_increment_minutes),
  );
  const [grace, setGrace] = useState(String(settings.grace_period_minutes));
  const [overtimeMode, setOvertimeMode] = useState(settings.overtime_mode);
  const [overtimeRate, setOvertimeRate] = useState(settings.overtime_rate_minor ?? 0);
  const [overtimeIncrement, setOvertimeIncrement] = useState(
    String(settings.overtime_increment_minutes ?? 30),
  );
  const [framesEnabled, setFramesEnabled] = useState(settings.frame_billing_enabled);
  const [framePrice, setFramePrice] = useState(settings.default_frame_price_minor ?? 0);
  const [notifyTimeCompleted, setNotifyTimeCompleted] = useState(settings.notify_on_time_completed);
  const [notifyPayment, setNotifyPayment] = useState(settings.notify_on_payment);
  const [lowStock, setLowStock] = useState(settings.low_stock_alerts_enabled);

  const positive = (value: string) => {
    const parsed = Number.parseInt(value.trim(), 10);
    return Number.isNaN(parsed) || parsed < 1 ? null : parsed;
  };
  const nonNegative = (value: string) => {
    const parsed = Number.parseInt(value.trim(), 10);
    return Number.isNaN(parsed) || parsed < 0 ? null : parsed;
  };

  const incrementValue = positive(increment);
  const minimumValue = nonNegative(minimum);
  const roundingValue = positive(roundingIncrement);
  const graceValue = nonNegative(grace);
  const overtimeIncrementValue = positive(overtimeIncrement);

  // Mirrors the CHECK constraints on the table. Catching these here turns a
  // Postgres constraint name into a sentence the owner can act on — the
  // database still refuses the write if this is ever wrong.
  const overtimeRateMissing = overtimeMode === 'OVERTIME_RATE' && overtimeRate <= 0;
  const overtimeBlockMissing =
    overtimeMode === 'INCREMENT_BLOCK' && overtimeIncrementValue === null;
  const framePriceMissing = framesEnabled && framePrice <= 0;

  const canSave =
    incrementValue !== null &&
    minimumValue !== null &&
    roundingValue !== null &&
    graceValue !== null &&
    !overtimeRateMissing &&
    !overtimeBlockMissing &&
    !framePriceMissing;

  function handleSave(): void {
    if (!canSave) return;

    save.mutate(
      {
        timeCalculationMode: timeMode,
        billingIncrementMinutes: incrementValue,
        minimumBillableMinutes: minimumValue,
        roundingMode,
        roundingIncrementMinutes: roundingValue,
        gracePeriodMinutes: graceValue,
        overtimeMode,
        // Cleared rather than left stale when the mode no longer uses them, so
        // switching back later cannot silently resurrect an old rate.
        overtimeRateMinor: overtimeMode === 'OVERTIME_RATE' ? overtimeRate : null,
        overtimeIncrementMinutes:
          overtimeMode === 'INCREMENT_BLOCK' ? overtimeIncrementValue : null,
        frameBillingEnabled: framesEnabled,
        defaultFramePriceMinor: framesEnabled ? framePrice : null,
        notifyOnTimeCompleted: notifyTimeCompleted,
        notifyOnPayment: notifyPayment,
        lowStockAlertsEnabled: lowStock,
      },
      {
        onSuccess: () => toast.success('Billing rules saved'),
        onError: (error) => toast.error(error, 'Could not save the billing rules.'),
      },
    );
  }

  return (
    <Screen padded={false} testID="billing-screen">
      <ScrollView
        contentContainerStyle={{
          padding: theme.spacing.lg,
          gap: theme.spacing.xl,
          paddingBottom: theme.spacing['5xl'],
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View>
          <SectionHeader
            title="Billable time"
            subtitle="How the clock becomes a charge. Actual time played is always recorded in full."
          />
          <Card style={{ gap: theme.spacing.lg }}>
            <Select
              label="Charge by"
              value={timeMode}
              onChange={setTimeMode}
              options={[...TIME_MODES]}
              testID="time-mode"
            />
            <Input
              label="Block length (minutes)"
              value={increment}
              onChangeText={setIncrement}
              keyboardType="number-pad"
              hint="Used when charging in blocks."
              error={
                incrementValue === null ? 'Enter a whole number of minutes above zero.' : undefined
              }
            />
            <Input
              label="Minimum billable (minutes)"
              value={minimum}
              onChangeText={setMinimum}
              keyboardType="number-pad"
              hint="A short session is still charged at least this much. 0 for none."
              error={minimumValue === null ? 'Enter 0 or more.' : undefined}
            />
          </Card>
        </View>

        <View>
          <SectionHeader title="Rounding" subtitle="Applied after the time above is worked out" />
          <Card style={{ gap: theme.spacing.lg }}>
            <Select
              label="Round"
              value={roundingMode}
              onChange={setRoundingMode}
              options={[...ROUNDING_MODES]}
              testID="rounding-mode"
            />
            <Input
              label="To the nearest (minutes)"
              value={roundingIncrement}
              onChangeText={setRoundingIncrement}
              keyboardType="number-pad"
              error={
                roundingValue === null ? 'Enter a whole number of minutes above zero.' : undefined
              }
            />
          </Card>
        </View>

        <View>
          <SectionHeader
            title="Overtime"
            subtitle="What happens once a booked session runs past its time"
          />
          <Card style={{ gap: theme.spacing.lg }}>
            <Input
              label="Grace period (minutes)"
              value={grace}
              onChangeText={setGrace}
              keyboardType="number-pad"
              hint="Free minutes before overtime starts."
              error={graceValue === null ? 'Enter 0 or more.' : undefined}
            />
            <Select
              label="Charge overtime at"
              value={overtimeMode}
              onChange={setOvertimeMode}
              options={[...OVERTIME_MODES]}
              testID="overtime-mode"
            />

            {overtimeMode === 'OVERTIME_RATE' ? (
              <MoneyInput
                label="Overtime rate"
                value={overtimeRate}
                onChange={setOvertimeRate}
                currency={currency}
                hint="Per hour, matching how the table's own rate is quoted."
                {...(overtimeRateMissing ? { error: 'Set a rate above zero.' } : {})}
              />
            ) : null}

            {overtimeMode === 'INCREMENT_BLOCK' ? (
              <>
                <Input
                  label="Overtime block (minutes)"
                  value={overtimeIncrement}
                  onChangeText={setOvertimeIncrement}
                  keyboardType="number-pad"
                  error={
                    overtimeBlockMissing ? 'Enter a whole number of minutes above zero.' : undefined
                  }
                />
                <MoneyInput
                  label="Price per block"
                  value={overtimeRate}
                  onChange={setOvertimeRate}
                  currency={currency}
                  hint="Charged for each block started, whole or not."
                />
              </>
            ) : null}
          </Card>
        </View>

        <View>
          <SectionHeader title="Frames" subtitle="For clubs that charge per frame of snooker" />
          <Card style={{ gap: theme.spacing.lg }}>
            <Toggle
              label="Charge for frames"
              description="Adds a per-frame charge on top of table time. Staff record frames as they are played."
              value={framesEnabled}
              onChange={setFramesEnabled}
              testID="frames-enabled"
            />
            {framesEnabled ? (
              <MoneyInput
                label="Price per frame"
                value={framePrice}
                onChange={setFramePrice}
                currency={currency}
                hint="A table's own pricing rule can override this."
                {...(framePriceMissing ? { error: 'Set a price above zero.' } : {})}
              />
            ) : null}
          </Card>
        </View>

        <View>
          <SectionHeader title="Alerts" subtitle="What this club is told about, and when" />
          <Card style={{ gap: theme.spacing.md }}>
            <Toggle
              label="Booked time finished"
              description="Tell staff when a booked session reaches its time. The session keeps running."
              value={notifyTimeCompleted}
              onChange={setNotifyTimeCompleted}
            />
            <Divider />
            <Toggle
              label="Payment received"
              description="Notify the owner when a session is paid."
              value={notifyPayment}
              onChange={setNotifyPayment}
            />
            <Divider />
            <Toggle
              label="Low stock"
              description="Warn when a product drops below its reorder level."
              value={lowStock}
              onChange={setLowStock}
            />
          </Card>
        </View>

        <Button
          label="Save billing rules"
          fullWidth
          size="lg"
          disabled={!canSave}
          loading={save.isPending}
          onPress={handleSave}
          testID="save-billing"
        />

        <Text variant="caption" color="textMuted">
          Changes apply to sessions that start from now on, and to what a running session will be
          charged when it closes. Sessions already closed keep the price they were charged.
        </Text>
      </ScrollView>
    </Screen>
  );
}

function Toggle({
  label,
  description,
  value,
  onChange,
  testID,
}: {
  readonly label: string;
  readonly description: string;
  readonly value: boolean;
  readonly onChange: (value: boolean) => void;
  readonly testID?: string;
}) {
  const theme = useTheme();

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="bodySm">{label}</Text>
        <Text variant="caption" color="textMuted">
          {description}
        </Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        accessibilityLabel={label}
        trackColor={{ true: theme.colors.primary, false: theme.colors.borderStrong }}
        testID={testID}
      />
    </View>
  );
}
