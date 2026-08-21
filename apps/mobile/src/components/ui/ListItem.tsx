import { ChevronRight, Minus, Plus } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';

import { useTheme } from '@/theme';

import { Text } from './Text';

export interface ListItemProps {
  readonly title: string;
  readonly subtitle?: string;
  readonly icon?: LucideIcon;
  /** Rendered on the right - a price, a badge, a control. */
  readonly trailing?: React.ReactNode;
  readonly onPress?: () => void;
  readonly disabled?: boolean;
  readonly showChevron?: boolean;
  readonly style?: ViewStyle;
  readonly testID?: string;
}

export function ListItem({
  title,
  subtitle,
  icon: Icon,
  trailing,
  onPress,
  disabled = false,
  showChevron = false,
  style,
  testID,
}: ListItemProps) {
  const theme = useTheme();

  const content = (
    <>
      {Icon ? (
        <View
          style={{
            width: 36,
            height: 36,
            borderRadius: theme.radius.sm,
            backgroundColor: theme.colors.surfaceSunken,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon size={18} color={theme.colors.textSecondary} />
        </View>
      ) : null}

      <View style={styles.grow}>
        <Text variant="titleSm" numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" color="textMuted" numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>

      {trailing}
      {showChevron ? <ChevronRight size={18} color={theme.colors.textMuted} /> : null}
    </>
  );

  const baseStyle: ViewStyle = {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    minHeight: theme.touchTarget.comfortable,
    paddingVertical: theme.spacing.sm,
    opacity: disabled ? 0.45 : 1,
  };

  if (!onPress || disabled) {
    return (
      <View testID={testID} style={[baseStyle, style]}>
        {content}
      </View>
    );
  }

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      style={({ pressed }) => [baseStyle, pressed ? { opacity: 0.6 } : null, style]}
    >
      {content}
    </Pressable>
  );
}

export interface QuantityStepperProps {
  readonly value: number;
  readonly onChange: (value: number) => void;
  readonly min?: number;
  readonly max?: number;
  readonly label?: string;
}

/**
 * Plus/minus control for quantities.
 *
 * Buttons rather than a numeric keyboard: adding a second bottle of water is a
 * one-tap job at the counter, and a keypad would be slower and more error-prone
 * for the 1-to-5 range that covers almost every sale.
 */
export function QuantityStepper({
  value,
  onChange,
  min = 0,
  max = 99,
  label = 'Quantity',
}: QuantityStepperProps) {
  const theme = useTheme();

  const step = (delta: number): void => {
    const next = Math.min(max, Math.max(min, value + delta));
    if (next !== value) onChange(next);
  };

  const button = (
    icon: LucideIcon,
    delta: number,
    accessibilityLabel: string,
    enabled: boolean,
  ) => {
    const Icon = icon;
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ disabled: !enabled }}
        disabled={!enabled}
        onPress={() => step(delta)}
        hitSlop={6}
        style={({ pressed }) => [
          styles.stepButton,
          {
            borderRadius: theme.radius.sm,
            backgroundColor: theme.colors.surfaceSunken,
            opacity: !enabled ? 0.35 : pressed ? 0.6 : 1,
          },
        ]}
      >
        <Icon size={16} color={theme.colors.textPrimary} />
      </Pressable>
    );
  };

  return (
    <View
      accessibilityLabel={`${label}: ${value}`}
      style={[styles.stepper, { gap: theme.spacing.sm }]}
    >
      {button(Minus, -1, `Decrease ${label.toLowerCase()}`, value > min)}
      <Text variant="titleMd" style={styles.stepValue}>
        {value}
      </Text>
      {button(Plus, 1, `Increase ${label.toLowerCase()}`, value < max)}
    </View>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  stepper: { flexDirection: 'row', alignItems: 'center' },
  stepButton: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  stepValue: { minWidth: 26, textAlign: 'center', fontVariant: ['tabular-nums'] },
});
