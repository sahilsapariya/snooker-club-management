import { useEffect, useState } from 'react';
import { View } from 'react-native';

import {
  Button,
  Divider,
  Input,
  MoneyInput,
  QuantityStepper,
  Select,
  Sheet,
  Text,
  useToast,
} from '@/components/ui';
import type { TableType } from '@/features/tables';
import type { CurrencyConfig } from '@/lib/format';
import { useTheme } from '@/theme';

import type { PricingMode, PricingRuleWithType } from '../api/pricing.api';
import {
  useCreatePricingRule,
  useSetPricingRuleActive,
  useUpdatePricingRule,
} from '../hooks/use-pricing';

const MODES: readonly { value: PricingMode; label: string; hint: string }[] = [
  { value: 'PER_HOUR', label: 'Hourly', hint: 'Rate per hour' },
  { value: 'PER_MINUTE', label: 'Per minute', hint: 'Rate per minute' },
  { value: 'FIXED_INCREMENT', label: 'Blocks', hint: 'Rate per block' },
  { value: 'PER_FRAME', label: 'Per frame', hint: 'Time not charged' },
  { value: 'FLAT_SESSION', label: 'Flat', hint: 'One price' },
];

export interface EditPricingRuleSheetProps {
  readonly visible: boolean;
  readonly onClose: () => void;
  /** null creates a new rule. */
  readonly rule: PricingRuleWithType | null;
  readonly tenantId: string;
  readonly currency: CurrencyConfig;
  readonly tableTypes: readonly TableType[];
}

/**
 * Create or edit a pricing rule.
 *
 * The form is mode-driven because the database constraints are: FIXED_INCREMENT
 * requires an increment, PER_FRAME requires a frame price. Asking for the wrong
 * fields would produce a save the database rejects, so the inputs change with
 * the mode rather than showing everything and hoping.
 *
 * How `rate_minor` is read also depends on the mode - per hour, per minute or
 * per block - which is why the label changes with it.
 */
export function EditPricingRuleSheet({
  visible,
  onClose,
  rule,
  tenantId,
  currency,
  tableTypes,
}: EditPricingRuleSheetProps) {
  const theme = useTheme();
  const toast = useToast();

  const createRule = useCreatePricingRule(tenantId);
  const updateRule = useUpdatePricingRule(tenantId);
  const setActive = useSetPricingRuleActive(tenantId);

  const [name, setName] = useState('');
  const [tableTypeId, setTableTypeId] = useState<string | null>(null);
  const [mode, setMode] = useState<PricingMode>('PER_HOUR');
  const [rateMinor, setRateMinor] = useState(0);
  const [incrementMinutes, setIncrementMinutes] = useState(30);
  const [minimumMinutes, setMinimumMinutes] = useState(0);
  const [framePriceMinor, setFramePriceMinor] = useState(0);
  const [isDefault, setIsDefault] = useState(true);

  useEffect(() => {
    if (!visible) return;
    setName(rule?.name ?? '');
    setTableTypeId(rule?.table_type_id ?? null);
    setMode(rule?.pricing_mode ?? 'PER_HOUR');
    setRateMinor(rule?.rate_minor ?? 0);
    setIncrementMinutes(rule?.increment_minutes ?? 30);
    setMinimumMinutes(rule?.minimum_minutes ?? 0);
    setFramePriceMinor(rule?.frame_price_minor ?? 0);
    setIsDefault(rule?.is_default ?? true);
  }, [visible, rule]);

  const isEditing = rule !== null;
  const needsIncrement = mode === 'FIXED_INCREMENT';
  const needsFramePrice = mode === 'PER_FRAME';
  const chargesTime = mode !== 'PER_FRAME';

  const rateLabel =
    mode === 'PER_HOUR'
      ? 'Rate per hour'
      : mode === 'PER_MINUTE'
        ? 'Rate per minute'
        : mode === 'FIXED_INCREMENT'
          ? `Rate per ${incrementMinutes} min block`
          : mode === 'FLAT_SESSION'
            ? 'Price per session'
            : 'Rate';

  const canSave =
    name.trim().length > 0 &&
    (!needsFramePrice || framePriceMinor > 0) &&
    (!needsIncrement || incrementMinutes > 0);

  function handleSave(): void {
    const input = {
      tenantId,
      tableTypeId,
      name: name.trim(),
      pricingMode: mode,
      rateMinor: chargesTime ? rateMinor : 0,
      incrementMinutes: needsIncrement ? incrementMinutes : null,
      minimumMinutes,
      framePriceMinor: framePriceMinor > 0 ? framePriceMinor : null,
      isDefault,
    };

    const onDone = {
      onSuccess: () => {
        toast.success(isEditing ? 'Pricing updated' : 'Pricing rule added');
        onClose();
      },
      onError: (error: unknown) => toast.error(error, 'Could not save the pricing rule.'),
    };

    if (isEditing && rule) {
      updateRule.mutate({ ...input, id: rule.id }, onDone);
    } else {
      createRule.mutate(input, onDone);
    }
  }

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={isEditing ? 'Edit pricing' : 'Add pricing rule'}
      subtitle="Sessions already running keep the rate they started with"
      testID="edit-pricing-sheet"
      footer={
        <Button
          label={isEditing ? 'Save changes' : 'Add rule'}
          size="lg"
          fullWidth
          disabled={!canSave}
          loading={createRule.isPending || updateRule.isPending}
          onPress={handleSave}
          testID="save-pricing-rule"
        />
      }
    >
      <View style={{ gap: theme.spacing.xl }}>
        <Input
          label="Name"
          value={name}
          onChangeText={setName}
          placeholder="Snooker · hourly"
          autoCapitalize="sentences"
        />

        <Select
          label="Applies to"
          value={tableTypeId}
          onChange={setTableTypeId}
          options={tableTypes.map((t) => ({ value: t.id, label: t.name }))}
        />

        <Select
          label="How time is charged"
          value={mode}
          onChange={setMode}
          options={MODES.map((m) => ({ value: m.value, label: m.label, hint: m.hint }))}
        />

        {chargesTime ? (
          <MoneyInput
            label={rateLabel}
            value={rateMinor}
            onChange={setRateMinor}
            currency={currency}
            testID="rate-input"
          />
        ) : null}

        {needsIncrement ? (
          <View style={{ gap: theme.spacing.sm }}>
            <Text variant="label" color="textSecondary">
              Block length (minutes)
            </Text>
            <Select
              value={incrementMinutes}
              onChange={setIncrementMinutes}
              options={[
                { value: 15, label: '15 min' },
                { value: 30, label: '30 min' },
                { value: 60, label: '60 min' },
              ]}
            />
          </View>
        ) : null}

        {needsFramePrice || framePriceMinor > 0 ? (
          <MoneyInput
            label="Price per frame"
            value={framePriceMinor}
            onChange={setFramePriceMinor}
            currency={currency}
            hint={
              needsFramePrice
                ? 'Required for per-frame pricing.'
                : 'Only used when frame billing is enabled.'
            }
          />
        ) : null}

        {chargesTime ? (
          <View style={{ gap: theme.spacing.sm }}>
            <Text variant="label" color="textSecondary">
              Minimum billable minutes
            </Text>
            <QuantityStepper
              value={minimumMinutes}
              onChange={setMinimumMinutes}
              min={0}
              max={180}
              label="Minimum"
            />
          </View>
        ) : null}

        <Select
          label="Default for this table type"
          value={isDefault ? 'yes' : 'no'}
          onChange={(v) => setIsDefault(v === 'yes')}
          options={[
            { value: 'yes', label: 'Yes' },
            { value: 'no', label: 'No' },
          ]}
        />

        {isEditing && rule ? (
          <>
            <Divider />
            <Button
              label={rule.is_active ? 'Deactivate this rule' : 'Reactivate this rule'}
              variant={rule.is_active ? 'ghost' : 'outline'}
              loading={setActive.isPending}
              onPress={() =>
                setActive.mutate(
                  { ruleId: rule.id, isActive: !rule.is_active },
                  {
                    onSuccess: () => {
                      toast.success(rule.is_active ? 'Rule deactivated' : 'Rule reactivated');
                      onClose();
                    },
                    onError: (error) => toast.error(error, 'Could not update the rule.'),
                  },
                )
              }
            />
          </>
        ) : null}
      </View>
    </Sheet>
  );
}
