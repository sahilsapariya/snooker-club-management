import { Check } from 'lucide-react-native';
import { Pressable, ScrollView, StyleSheet, View, type ViewStyle } from 'react-native';

import { useTheme } from '@/theme';

import { Text } from './Text';

export interface SelectOption<T extends string | number> {
  readonly value: T;
  readonly label: string;
  readonly hint?: string;
  readonly disabled?: boolean;
}

export interface SelectProps<T extends string | number> {
  readonly label?: string;
  readonly options: readonly SelectOption<T>[];
  readonly value: T | null;
  readonly onChange: (value: T) => void;
  readonly error?: string;
  readonly style?: ViewStyle;
  readonly testID?: string;
}

/**
 * Choice control rendered as a wrapping row of chips.
 *
 * A dropdown would need another modal layer and hides the options until
 * tapped. Club staff pick a duration or a payment method dozens of times an
 * evening, so every option stays visible and is one tap away.
 */
export function Select<T extends string | number>({
  label,
  options,
  value,
  onChange,
  error,
  style,
  testID,
}: SelectProps<T>) {
  const theme = useTheme();

  return (
    <View style={[{ gap: theme.spacing.sm }, style]} testID={testID}>
      {label ? (
        <Text variant="label" color="textSecondary">
          {label}
        </Text>
      ) : null}

      <View style={[styles.options, { gap: theme.spacing.sm }]}>
        {options.map((option) => {
          const selected = option.value === value;
          const disabled = option.disabled === true;

          return (
            <Pressable
              key={String(option.value)}
              accessibilityRole="radio"
              accessibilityState={{ selected, disabled }}
              accessibilityLabel={option.label}
              disabled={disabled}
              onPress={() => onChange(option.value)}
              style={({ pressed }) => [
                styles.chip,
                {
                  minHeight: theme.touchTarget.min,
                  paddingHorizontal: theme.spacing.lg,
                  borderRadius: theme.radius.md,
                  borderWidth: StyleSheet.hairlineWidth * 2,
                  gap: theme.spacing.xs,
                  backgroundColor: selected ? theme.colors.primaryContainer : theme.colors.surface,
                  borderColor: selected ? theme.colors.primary : theme.colors.border,
                  opacity: disabled ? 0.4 : pressed ? 0.75 : 1,
                },
              ]}
            >
              {selected ? <Check size={15} color={theme.colors.onPrimaryContainer} /> : null}
              <View>
                <Text
                  variant="titleSm"
                  style={{
                    color: selected ? theme.colors.onPrimaryContainer : theme.colors.textPrimary,
                  }}
                >
                  {option.label}
                </Text>
                {option.hint ? (
                  <Text variant="caption" color="textMuted">
                    {option.hint}
                  </Text>
                ) : null}
              </View>
            </Pressable>
          );
        })}
      </View>

      {error ? (
        <Text variant="caption" color="error" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

/** Horizontally scrolling variant, for long option lists such as categories. */
export function SelectScroller<T extends string | number>(props: SelectProps<T>) {
  const theme = useTheme();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: theme.spacing.lg, gap: theme.spacing.sm }}
    >
      <Select {...props} style={{ flexDirection: 'row' }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  options: { flexDirection: 'row', flexWrap: 'wrap' },
  chip: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
});
