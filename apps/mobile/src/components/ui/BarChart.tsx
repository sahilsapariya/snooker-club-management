import { useState } from 'react';
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';

import { useTheme } from '@/theme';

import { Text } from './Text';

export interface BarDatum {
  readonly label: string;
  readonly value: number;
  /** Shown when the bar is selected, e.g. a formatted amount. */
  readonly detail?: string;
}

export interface BarChartProps {
  readonly data: readonly BarDatum[];
  readonly height?: number;
  /** Every Nth label is drawn, to stop a 90-day range turning into mush. */
  readonly labelEvery?: number;
  readonly emptyMessage?: string;
  readonly style?: ViewStyle;
  readonly testID?: string;
}

/**
 * Minimal bar chart built from Views.
 *
 * A charting library would be the obvious reach, but every option is either a
 * native module (which would end Expo Go compatibility) or an SVG/canvas
 * dependency far heavier than this screen justifies. Bars are the only shape
 * needed here, and a flex row of rounded rectangles draws them exactly.
 *
 * Tapping a bar reveals its value, which is how a chart without axis labels
 * stays honest about the numbers.
 */
export function BarChart({
  data,
  height = 140,
  labelEvery,
  emptyMessage = 'No data for this period.',
  style,
  testID,
}: BarChartProps) {
  const theme = useTheme();
  const [selected, setSelected] = useState<number | null>(null);

  if (data.length === 0) {
    return (
      <View style={[{ height, justifyContent: 'center' }, style]}>
        <Text variant="bodySm" color="textMuted" align="center">
          {emptyMessage}
        </Text>
      </View>
    );
  }

  const max = Math.max(...data.map((d) => Math.abs(d.value)), 1);
  const hasNegative = data.some((d) => d.value < 0);
  // Negative bars (a loss-making day) hang below a zero line, so the shape of
  // the month is readable at a glance rather than every bar looking positive.
  const zeroLine = hasNegative ? height / 2 : height;
  const step = labelEvery ?? Math.max(1, Math.ceil(data.length / 7));

  const active = selected === null ? null : data[selected];

  return (
    <View style={[{ gap: theme.spacing.sm }, style]} testID={testID}>
      <View style={{ height: theme.spacing.xl, justifyContent: 'center' }}>
        {active ? (
          <Text variant="label" color="textPrimary">
            {active.label} · {active.detail ?? String(active.value)}
          </Text>
        ) : (
          <Text variant="caption" color="textMuted">
            Tap a bar for the exact figure
          </Text>
        )}
      </View>

      <View style={[styles.plot, { height, gap: 3 }]}>
        {hasNegative ? (
          <View
            pointerEvents="none"
            style={[styles.zeroLine, { bottom: zeroLine, backgroundColor: theme.colors.border }]}
          />
        ) : null}

        {data.map((datum, index) => {
          const magnitude = (Math.abs(datum.value) / max) * (hasNegative ? height / 2 : height);
          const isSelected = selected === index;
          const isNegative = datum.value < 0;

          return (
            <Pressable
              key={`${datum.label}-${index}`}
              accessibilityRole="button"
              accessibilityLabel={`${datum.label}: ${datum.detail ?? datum.value}`}
              onPress={() => setSelected(isSelected ? null : index)}
              style={styles.column}
            >
              <View
                style={{
                  position: 'absolute',
                  bottom: isNegative ? zeroLine - magnitude : zeroLine - magnitude,
                  height: Math.max(2, magnitude),
                  left: 0,
                  right: 0,
                  borderRadius: theme.radius.sm,
                  backgroundColor: isNegative
                    ? theme.colors.error
                    : isSelected
                      ? theme.colors.primary
                      : theme.colors.primaryContainer,
                }}
              />
            </Pressable>
          );
        })}
      </View>

      <View style={styles.labels}>
        {data.map((datum, index) => (
          <View key={`label-${datum.label}-${index}`} style={styles.column}>
            {index % step === 0 ? (
              <Text variant="caption" color="textMuted" numberOfLines={1} align="center">
                {datum.label}
              </Text>
            ) : null}
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  plot: { flexDirection: 'row', alignItems: 'flex-end' },
  column: { flex: 1, height: '100%' },
  labels: { flexDirection: 'row', gap: 3 },
  zeroLine: { position: 'absolute', left: 0, right: 0, height: StyleSheet.hairlineWidth },
});
