import { useEffect, useState } from 'react';
import { StyleSheet, TextInput, View, type ViewStyle } from 'react-native';

import { currencySymbol, formatMoney, parseMoneyToMinor, type CurrencyConfig } from '@/lib/format';
import { useTheme } from '@/theme';

import { Text } from './Text';

export interface MoneyInputProps {
  readonly label?: string;
  readonly value: number;
  readonly onChange: (amountMinor: number) => void;
  readonly currency: CurrencyConfig;
  readonly placeholder?: string;
  readonly error?: string;
  readonly hint?: string;
  readonly autoFocus?: boolean;
  readonly style?: ViewStyle;
  readonly testID?: string;
}

/**
 * Amount entry that never leaves integer minor units.
 *
 * The component owns a text draft while the field is being edited, because
 * formatting mid-typing fights the user - "1" would become "1.00" before they
 * can type the rest. The draft is parsed on every keystroke so the caller
 * always has a valid amount, and it is re-formatted on blur.
 *
 * The parent only ever sees minor units, so no float reaches the database.
 */
export function MoneyInput({
  label,
  value,
  onChange,
  currency,
  placeholder,
  error,
  hint,
  autoFocus = false,
  style,
  testID,
}: MoneyInputProps) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState(() => formatMoney(value, { currency, withSymbol: false }));

  // Follow external changes (a "pay exact" button, say) unless the user is
  // mid-edit, where overwriting their input would be hostile.
  useEffect(() => {
    if (!focused) setDraft(formatMoney(value, { currency, withSymbol: false }));
  }, [value, currency, focused]);

  function handleChangeText(text: string): void {
    setDraft(text);
    const parsed = parseMoneyToMinor(text, currency);
    onChange(parsed ?? 0);
  }

  return (
    <View style={[{ gap: theme.spacing.xs }, style]}>
      {label ? (
        <Text variant="label" color="textSecondary">
          {label}
        </Text>
      ) : null}

      <View
        style={[
          styles.field,
          {
            backgroundColor: theme.colors.surface,
            borderColor: error
              ? theme.colors.error
              : focused
                ? theme.colors.primary
                : theme.colors.border,
            borderRadius: theme.radius.md,
            minHeight: theme.touchTarget.comfortable,
            paddingHorizontal: theme.spacing.md,
            gap: theme.spacing.xs,
          },
        ]}
      >
        <Text variant="titleMd" color="textMuted">
          {currencySymbol(currency.code).trim()}
        </Text>
        <TextInput
          testID={testID}
          value={draft}
          onChangeText={handleChangeText}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            setDraft(formatMoney(value, { currency, withSymbol: false }));
          }}
          placeholder={placeholder ?? '0.00'}
          placeholderTextColor={theme.colors.textMuted}
          keyboardType="decimal-pad"
          inputMode="decimal"
          autoFocus={autoFocus}
          selectTextOnFocus
          style={[theme.typography.titleMd, styles.input, { color: theme.colors.textPrimary }]}
        />
      </View>

      {error ? (
        <Text variant="caption" color="error" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : hint ? (
        <Text variant="caption" color="textMuted">
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth * 2,
  },
  input: { flex: 1, paddingVertical: 10, fontVariant: ['tabular-nums'] },
});
