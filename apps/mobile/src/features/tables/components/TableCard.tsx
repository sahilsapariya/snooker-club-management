import { CircleDot, Clock, Wrench } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import {
  Badge,
  Card,
  MoneyValue,
  SessionStatusBadge,
  TableStatusBadge,
  Text,
  Timer,
} from '@/components/ui';
import type { CurrencyConfig } from '@/lib/format';
import { useTheme } from '@/theme';

import type { ClubTableOverview } from '../api/tables.api';

export interface TableCardProps {
  readonly table: ClubTableOverview;
  readonly currency: CurrencyConfig;
  readonly onPress?: () => void;
}

/**
 * One physical table on the floor.
 *
 * When occupied, the card shows the live elapsed clock from the session's
 * recorded `started_at`. That clock keeps counting past the booked duration:
 * the session's state changes to "Time up", but nothing here ends it. Only a
 * receptionist closes a session.
 */
export function TableCard({ table, currency, onPress }: TableCardProps) {
  const theme = useTheme();

  const isOccupied = table.is_occupied === true;
  const isInactive = table.is_active !== true;
  const isOvertime = table.active_session_status === 'TIME_COMPLETED';

  const accentColor = isInactive
    ? theme.colors.textMuted
    : isOvertime
      ? theme.colors.warning
      : isOccupied
        ? theme.colors.info
        : table.status === 'AVAILABLE'
          ? theme.colors.success
          : theme.colors.warning;

  return (
    <Card
      elevated={isOccupied}
      {...(onPress ? { onPress } : {})}
      accessibilityLabel={`${table.name ?? 'Table'}, ${isOccupied ? 'in play' : 'free'}`}
      style={{ opacity: isInactive ? 0.55 : 1, gap: theme.spacing.md }}
    >
      <View style={styles.header}>
        <View style={[styles.accent, { backgroundColor: accentColor }]} />

        <View style={styles.grow}>
          <Text variant="titleMd" numberOfLines={1}>
            {table.name ?? 'Untitled table'}
          </Text>
          <Text variant="caption" color="textMuted">
            {table.table_type_name ?? 'Unknown type'}
            {table.table_number === null ? '' : ` · No. ${table.table_number}`}
          </Text>
        </View>

        {isInactive ? (
          <Badge label="Inactive" tone="neutral" />
        ) : isOccupied && table.active_session_status ? (
          <SessionStatusBadge status={table.active_session_status} />
        ) : (
          <TableStatusBadge status={table.status ?? 'AVAILABLE'} />
        )}
      </View>

      {isOccupied && table.active_session_started_at ? (
        <View
          style={[
            styles.sessionRow,
            {
              backgroundColor: isOvertime
                ? theme.colors.warningContainer
                : theme.colors.surfaceSunken,
              borderRadius: theme.radius.md,
              padding: theme.spacing.md,
              gap: theme.spacing.md,
            },
          ]}
        >
          <View style={[styles.inline, { gap: theme.spacing.xs }]}>
            <Clock
              size={15}
              color={isOvertime ? theme.colors.warning : theme.colors.textSecondary}
            />
            <Timer
              startedAtIso={table.active_session_started_at}
              variant="titleMd"
              tone={isOvertime ? 'warning' : 'textPrimary'}
            />
          </View>

          <View style={styles.grow} />

          <View style={styles.alignEnd}>
            <Text variant="caption" color="textMuted">
              {table.active_session_planned_minutes === null
                ? 'No booked time'
                : `Booked ${table.active_session_planned_minutes}m`}
            </Text>
            <MoneyValue
              amountMinor={Number(table.active_session_total_minor ?? 0)}
              currency={currency}
              variant="titleMd"
            />
          </View>
        </View>
      ) : table.status === 'AVAILABLE' && !isInactive ? (
        <View style={[styles.inline, { gap: theme.spacing.xs }]}>
          <CircleDot size={14} color={theme.colors.success} />
          <Text variant="bodySm" color="textMuted">
            Free now
          </Text>
        </View>
      ) : (
        <View style={[styles.inline, { gap: theme.spacing.xs }]}>
          <Wrench size={14} color={theme.colors.warning} />
          <Text variant="bodySm" color="textMuted" numberOfLines={2}>
            {table.notes ?? 'Not available for play'}
          </Text>
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  accent: { width: 4, height: 36, borderRadius: 2 },
  grow: { flex: 1 },
  inline: { flexDirection: 'row', alignItems: 'center' },
  sessionRow: { flexDirection: 'row', alignItems: 'center' },
  alignEnd: { alignItems: 'flex-end' },
});
