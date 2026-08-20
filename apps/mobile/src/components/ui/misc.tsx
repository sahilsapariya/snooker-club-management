import type { LucideIcon } from 'lucide-react-native';
import { useEffect, useReducer } from 'react';
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';

import { elapsedSecondsSince, formatClock, formatMoney, type CurrencyConfig } from '@/lib/format';
import { useTheme } from '@/theme';

import { Text } from './Text';

/** Hairline separator. */
export function Divider({ style }: { readonly style?: ViewStyle }) {
  const theme = useTheme();
  return (
    <View
      style={[{ height: StyleSheet.hairlineWidth, backgroundColor: theme.colors.divider }, style]}
    />
  );
}

export interface SectionHeaderProps {
  readonly title: string;
  readonly subtitle?: string;
  readonly action?: { readonly label: string; readonly onPress: () => void };
}

export function SectionHeader({ title, subtitle, action }: SectionHeaderProps) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.row,
        { marginBottom: theme.spacing.sm, gap: theme.spacing.md, alignItems: 'flex-end' },
      ]}
    >
      <View style={styles.grow}>
        <Text variant="titleSm" color="textSecondary">
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" color="textMuted">
            {subtitle}
          </Text>
        ) : null}
      </View>
      {action ? (
        <Pressable accessibilityRole="button" hitSlop={8} onPress={action.onPress}>
          <Text variant="label" color="primaryOnSurface">
            {action.label}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export interface MoneyValueProps {
  readonly amountMinor: number;
  readonly currency?: CurrencyConfig;
  readonly variant?: 'body' | 'titleMd' | 'titleLg' | 'displayMd';
  readonly tone?: 'textPrimary' | 'textSecondary' | 'success' | 'error' | 'primaryOnSurface';
}

/** Money, always rendered from integer minor units. */
export function MoneyValue({
  amountMinor,
  currency,
  variant = 'body',
  tone = 'textPrimary',
}: MoneyValueProps) {
  return (
    <Text variant={variant} color={tone} style={styles.tabular}>
      {formatMoney(amountMinor, currency ? { currency } : {})}
    </Text>
  );
}

export interface TimerProps {
  /** ISO timestamp the session actually started at. */
  readonly startedAtIso: string;
  readonly variant?: 'body' | 'titleMd' | 'titleLg';
  readonly tone?: 'textPrimary' | 'textSecondary' | 'warning' | 'error';
}

/**
 * Live elapsed clock for a running session.
 *
 * Counts up from the recorded `started_at` and never stops on its own: passing
 * the booked time changes how the row is presented, not whether the clock runs.
 */
export function Timer({ startedAtIso, variant = 'body', tone = 'textPrimary' }: TimerProps) {
  // The elapsed time is derived during render rather than stored in state, so
  // it is always correct for the current `startedAtIso` with no resync effect.
  // The effect exists only to schedule a re-render each second.
  const [, tick] = useReducer((count: number) => count + 1, 0);

  useEffect(() => {
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, []);

  const elapsed = elapsedSecondsSince(startedAtIso);

  return (
    <Text variant={variant} color={tone} style={styles.tabular} accessibilityLabel="Elapsed time">
      {formatClock(elapsed)}
    </Text>
  );
}

export interface AvatarProps {
  readonly name: string;
  readonly size?: number;
}

/** Initials avatar. No image loading, so it can never be a layout jump. */
export function Avatar({ name, size = 40 }: AvatarProps) {
  const theme = useTheme();
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: theme.radius.full,
        backgroundColor: theme.colors.primaryContainer,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text variant="titleSm" style={{ color: theme.colors.onPrimaryContainer }}>
        {initials || '?'}
      </Text>
    </View>
  );
}

export interface IconButtonProps {
  readonly icon: LucideIcon;
  readonly onPress: () => void;
  readonly accessibilityLabel: string;
  readonly tone?: 'default' | 'brand' | 'danger';
  readonly size?: number;
}

export function IconButton({
  icon: Icon,
  onPress,
  accessibilityLabel,
  tone = 'default',
  size = 20,
}: IconButtonProps) {
  const theme = useTheme();
  const color =
    tone === 'brand'
      ? theme.colors.primaryOnSurface
      : tone === 'danger'
        ? theme.colors.error
        : theme.colors.textSecondary;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      hitSlop={10}
      style={({ pressed }) => [
        {
          width: theme.touchTarget.min,
          height: theme.touchTarget.min,
          borderRadius: theme.radius.full,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: pressed ? 0.6 : 1,
        },
      ]}
    >
      <Icon size={size} color={color} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  grow: { flex: 1 },
  tabular: { fontVariant: ['tabular-nums'] },
});
