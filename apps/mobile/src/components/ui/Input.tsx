import type { LucideIcon } from 'lucide-react-native';
import { Eye, EyeOff } from 'lucide-react-native';
import { forwardRef, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';

import { useTheme } from '@/theme';

import { Text } from './Text';

export interface InputProps extends Omit<TextInputProps, 'style'> {
  readonly label?: string;
  readonly error?: string | undefined;
  readonly hint?: string;
  readonly icon?: LucideIcon;
  readonly containerStyle?: ViewStyle;
}

/**
 * Text field with label, hint and error slots.
 *
 * The error is rendered inline and announced, rather than shown in an alert:
 * a receptionist correcting a typo should not have to dismiss anything.
 */
export const Input = forwardRef<TextInput, InputProps>(function Input(
  { label, error, hint, icon: Icon, containerStyle, secureTextEntry, ...rest },
  ref,
) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  const [revealed, setRevealed] = useState(false);

  const isPassword = secureTextEntry === true;
  const borderColor = error
    ? theme.colors.error
    : focused
      ? theme.colors.primary
      : theme.colors.border;

  return (
    <View style={[{ gap: theme.spacing.xs }, containerStyle]}>
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
            borderColor,
            borderRadius: theme.radius.md,
            minHeight: theme.touchTarget.comfortable,
            paddingHorizontal: theme.spacing.md,
            gap: theme.spacing.sm,
          },
        ]}
      >
        {Icon ? <Icon size={18} color={theme.colors.textMuted} /> : null}

        <TextInput
          ref={ref}
          {...rest}
          secureTextEntry={isPassword && !revealed}
          onFocus={(event) => {
            setFocused(true);
            rest.onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            rest.onBlur?.(event);
          }}
          placeholderTextColor={theme.colors.textMuted}
          style={[theme.typography.body, styles.input, { color: theme.colors.textPrimary }]}
        />

        {isPassword ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={revealed ? 'Hide password' : 'Show password'}
            hitSlop={12}
            onPress={() => setRevealed((value) => !value)}
          >
            {revealed ? (
              <EyeOff size={18} color={theme.colors.textMuted} />
            ) : (
              <Eye size={18} color={theme.colors.textMuted} />
            )}
          </Pressable>
        ) : null}
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
});

const styles = StyleSheet.create({
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth * 2,
  },
  input: {
    flex: 1,
    paddingVertical: 12,
  },
});
