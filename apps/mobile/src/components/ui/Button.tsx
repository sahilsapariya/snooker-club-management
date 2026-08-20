import * as Haptics from 'expo-haptics';
import type { LucideIcon } from 'lucide-react-native';
import { ActivityIndicator, Pressable, StyleSheet, View, type ViewStyle } from 'react-native';

import { useTheme } from '@/theme';

import { Text } from './Text';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps {
  readonly label: string;
  readonly onPress?: () => void;
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly icon?: LucideIcon;
  readonly loading?: boolean;
  readonly disabled?: boolean;
  readonly fullWidth?: boolean;
  readonly style?: ViewStyle;
  readonly testID?: string;
  readonly accessibilityHint?: string;
}

const SIZES = {
  sm: { height: 40, paddingHorizontal: 14, gap: 6, iconSize: 16, variant: 'label' },
  md: { height: 48, paddingHorizontal: 18, gap: 8, iconSize: 18, variant: 'titleSm' },
  lg: { height: 56, paddingHorizontal: 22, gap: 10, iconSize: 20, variant: 'titleMd' },
} as const;

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  icon: Icon,
  loading = false,
  disabled = false,
  fullWidth = false,
  style,
  testID,
  accessibilityHint,
}: ButtonProps) {
  const theme = useTheme();
  const metrics = SIZES[size];
  const isInteractive = !disabled && !loading;

  const palette = {
    primary: {
      background: theme.colors.primary,
      foreground: theme.colors.primaryForeground,
      border: 'transparent',
    },
    secondary: {
      background: theme.colors.primaryContainer,
      foreground: theme.colors.onPrimaryContainer,
      border: 'transparent',
    },
    outline: {
      background: 'transparent',
      foreground: theme.colors.primaryOnSurface,
      border: theme.colors.borderStrong,
    },
    ghost: {
      background: 'transparent',
      foreground: theme.colors.primaryOnSurface,
      border: 'transparent',
    },
    danger: {
      background: theme.colors.error,
      foreground: theme.colors.textInverse,
      border: 'transparent',
    },
  }[variant];

  function handlePress(): void {
    if (!isInteractive) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress?.();
  }

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !isInteractive, busy: loading }}
      {...(accessibilityHint === undefined ? {} : { accessibilityHint })}
      onPress={handlePress}
      disabled={!isInteractive}
      style={({ pressed }) => [
        styles.base,
        {
          height: metrics.height,
          paddingHorizontal: metrics.paddingHorizontal,
          gap: metrics.gap,
          borderRadius: theme.radius.md,
          backgroundColor: palette.background,
          borderColor: palette.border,
          borderWidth: variant === 'outline' ? StyleSheet.hairlineWidth * 2 : 0,
          opacity: !isInteractive ? 0.45 : pressed ? 0.85 : 1,
        },
        fullWidth ? styles.fullWidth : null,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={palette.foreground} />
      ) : (
        <View style={styles.content}>
          {Icon ? <Icon size={metrics.iconSize} color={palette.foreground} /> : null}
          <Text variant={metrics.variant} style={{ color: palette.foreground }}>
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  fullWidth: {
    alignSelf: 'stretch',
  },
});
