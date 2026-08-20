import { Text as RNText, type TextProps as RNTextProps, type TextStyle } from 'react-native';

import { useTheme, type TypographyVariant } from '@/theme';

type ColorToken =
  | 'textPrimary'
  | 'textSecondary'
  | 'textMuted'
  | 'textInverse'
  | 'primary'
  | 'primaryOnSurface'
  | 'primaryForeground'
  | 'onPrimaryContainer'
  | 'success'
  | 'warning'
  | 'error'
  | 'info';

export interface TextProps extends RNTextProps {
  readonly variant?: TypographyVariant;
  readonly color?: ColorToken;
  readonly align?: TextStyle['textAlign'];
}

/**
 * The only text primitive in the app.
 *
 * Sizes come from the type scale and colours from semantic tokens, so a club's
 * brand colour can change without a single `color:` literal moving.
 */
export function Text({
  variant = 'body',
  color = 'textPrimary',
  align,
  style,
  ...rest
}: TextProps) {
  const theme = useTheme();

  return (
    <RNText
      {...rest}
      style={[
        theme.typography[variant],
        { color: theme.colors[color] },
        align ? { textAlign: align } : null,
        style,
      ]}
    />
  );
}
