import { StyleSheet, View, type ViewStyle } from 'react-native';

import { useTheme } from '@/theme';

import { Text } from './Text';

export type BadgeTone = 'neutral' | 'brand' | 'success' | 'warning' | 'error' | 'info';

export interface BadgeProps {
  readonly label: string;
  readonly tone?: BadgeTone;
  readonly style?: ViewStyle;
}

/**
 * Small status pill.
 *
 * `brand` is the only tone tied to the club's colour. Everything that carries
 * meaning - paid, overdue, needs repair - uses a fixed status tone, so the same
 * state reads the same way in every club.
 */
export function Badge({ label, tone = 'neutral', style }: BadgeProps) {
  const theme = useTheme();

  const palette: Record<BadgeTone, { background: string; foreground: string }> = {
    neutral: { background: theme.colors.surfaceSunken, foreground: theme.colors.textSecondary },
    brand: {
      background: theme.colors.primaryContainer,
      foreground: theme.colors.onPrimaryContainer,
    },
    success: {
      background: theme.colors.successContainer,
      foreground: theme.colors.onSuccessContainer,
    },
    warning: {
      background: theme.colors.warningContainer,
      foreground: theme.colors.onWarningContainer,
    },
    error: { background: theme.colors.errorContainer, foreground: theme.colors.onErrorContainer },
    info: { background: theme.colors.infoContainer, foreground: theme.colors.onInfoContainer },
  };

  const { background, foreground } = palette[tone];

  return (
    <View
      style={[
        styles.badge,
        {
          backgroundColor: background,
          borderRadius: theme.radius.full,
          paddingHorizontal: theme.spacing.sm + 2,
          paddingVertical: theme.spacing.xs,
        },
        style,
      ]}
    >
      <Text variant="caption" style={{ color: foreground }} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
  },
});
