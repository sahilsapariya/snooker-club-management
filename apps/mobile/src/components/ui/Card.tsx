import { Pressable, StyleSheet, View, type ViewProps, type ViewStyle } from 'react-native';

import { useTheme } from '@/theme';

export interface CardProps extends ViewProps {
  readonly elevated?: boolean;
  readonly padded?: boolean;
  readonly onPress?: () => void;
  readonly accessibilityLabel?: string;
  readonly style?: ViewStyle;
}

/** Surface container. Becomes a pressable row when `onPress` is supplied. */
export function Card({
  elevated = false,
  padded = true,
  onPress,
  accessibilityLabel,
  style,
  children,
  ...rest
}: CardProps) {
  const theme = useTheme();

  const surfaceStyle: ViewStyle = {
    backgroundColor: elevated ? theme.colors.surfaceElevated : theme.colors.surface,
    borderRadius: theme.radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    padding: padded ? theme.spacing.lg : 0,
    ...(elevated ? theme.elevation(2) : {}),
  };

  if (onPress) {
    return (
      <Pressable
        accessibilityRole="button"
        {...(accessibilityLabel === undefined ? {} : { accessibilityLabel })}
        onPress={onPress}
        style={({ pressed }) => [surfaceStyle, pressed ? { opacity: 0.7 } : null, style]}
      >
        {children}
      </Pressable>
    );
  }

  return (
    <View {...rest} style={[surfaceStyle, style]}>
      {children}
    </View>
  );
}
