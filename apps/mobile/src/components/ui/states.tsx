import type { LucideIcon } from 'lucide-react-native';
import { AlertTriangle, Inbox } from 'lucide-react-native';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { AppError } from '@/lib/errors';
import { isDevelopment } from '@/constants/env';
import { useTheme } from '@/theme';

import { Button } from './Button';
import { Text } from './Text';

/**
 * The three states every data-backed screen has to handle.
 *
 * Grouped in one file because they are variations on a single centred-message
 * layout, and because having them adjacent makes it obvious when a screen is
 * missing one.
 */

export interface LoadingStateProps {
  readonly label?: string;
}

export function LoadingState({ label = 'Loading' }: LoadingStateProps) {
  const theme = useTheme();
  return (
    <View style={[styles.container, { padding: theme.spacing['3xl'], gap: theme.spacing.lg }]}>
      <ActivityIndicator size="large" color={theme.colors.primary} />
      <Text variant="bodySm" color="textMuted">
        {label}
      </Text>
    </View>
  );
}

export interface EmptyStateProps {
  readonly title: string;
  readonly description?: string;
  readonly icon?: LucideIcon;
  readonly actionLabel?: string;
  readonly onAction?: () => void;
}

export function EmptyState({
  title,
  description,
  icon: Icon = Inbox,
  actionLabel,
  onAction,
}: EmptyStateProps) {
  const theme = useTheme();
  return (
    <View style={[styles.container, { padding: theme.spacing['3xl'], gap: theme.spacing.md }]}>
      <View
        style={{
          width: 64,
          height: 64,
          borderRadius: theme.radius.full,
          backgroundColor: theme.colors.surfaceSunken,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon size={28} color={theme.colors.textMuted} />
      </View>
      <Text variant="titleMd" align="center">
        {title}
      </Text>
      {description ? (
        <Text variant="bodySm" color="textMuted" align="center">
          {description}
        </Text>
      ) : null}
      {actionLabel && onAction ? (
        <Button label={actionLabel} variant="secondary" size="sm" onPress={onAction} />
      ) : null}
    </View>
  );
}

export interface ErrorStateProps {
  readonly error: unknown;
  readonly onRetry?: () => void;
  readonly title?: string;
}

export function ErrorState({ error, onRetry, title = 'Something went wrong' }: ErrorStateProps) {
  const theme = useTheme();
  const appError = error instanceof AppError ? error : null;
  const message = appError?.userMessage ?? 'Please try again in a moment.';
  const canRetry = onRetry && (appError?.retryable ?? true);

  return (
    <View style={[styles.container, { padding: theme.spacing['3xl'], gap: theme.spacing.md }]}>
      <View
        style={{
          width: 64,
          height: 64,
          borderRadius: theme.radius.full,
          backgroundColor: theme.colors.errorContainer,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <AlertTriangle size={28} color={theme.colors.onErrorContainer} />
      </View>
      <Text variant="titleMd" align="center">
        {title}
      </Text>
      <Text variant="bodySm" color="textMuted" align="center">
        {message}
      </Text>

      {/* The raw cause is a development aid only; it never ships to a user. */}
      {isDevelopment && appError ? (
        <Text variant="caption" color="textMuted" align="center">
          {appError.code}: {appError.technicalMessage}
        </Text>
      ) : null}

      {canRetry ? (
        <Button label="Try again" variant="secondary" size="sm" onPress={onRetry} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
