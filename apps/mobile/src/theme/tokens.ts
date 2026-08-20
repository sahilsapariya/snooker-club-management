import { Platform, type TextStyle } from 'react-native';

/**
 * Brand-independent design tokens.
 *
 * Spacing, radii, type and elevation never change with a club's colour, so they
 * live outside `buildTheme`. Only colour is derived per tenant.
 */

/** 4pt grid. */
export const spacing = {
  none: 0,
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  '2xl': 24,
  '3xl': 32,
  '4xl': 40,
  '5xl': 48,
  '6xl': 64,
} as const;

export type SpacingToken = keyof typeof spacing;

export const radius = {
  none: 0,
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
  '2xl': 28,
  full: 999,
} as const;

export type RadiusToken = keyof typeof radius;

/**
 * Minimum interactive size. Club staff use this app one-handed, standing, often
 * in a hurry; 44pt is the floor, not the target.
 */
export const touchTarget = {
  min: 44,
  comfortable: 52,
} as const;

const fontFamily = Platform.select({
  ios: 'System',
  android: 'sans-serif',
  default: 'System',
});

const fontFamilyMedium = Platform.select({
  ios: 'System',
  android: 'sans-serif-medium',
  default: 'System',
});

export const fontWeight = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
} as const satisfies Record<string, TextStyle['fontWeight']>;

export type TypographyVariant =
  | 'displayLg'
  | 'displayMd'
  | 'titleLg'
  | 'titleMd'
  | 'titleSm'
  | 'body'
  | 'bodySm'
  | 'label'
  | 'caption'
  | 'numeric';

export const typography = {
  displayLg: {
    fontFamily: fontFamilyMedium,
    fontSize: 32,
    lineHeight: 38,
    fontWeight: fontWeight.bold,
    letterSpacing: -0.5,
  },
  displayMd: {
    fontFamily: fontFamilyMedium,
    fontSize: 26,
    lineHeight: 32,
    fontWeight: fontWeight.bold,
    letterSpacing: -0.3,
  },
  titleLg: {
    fontFamily: fontFamilyMedium,
    fontSize: 20,
    lineHeight: 26,
    fontWeight: fontWeight.semibold,
    letterSpacing: -0.2,
  },
  titleMd: {
    fontFamily: fontFamilyMedium,
    fontSize: 17,
    lineHeight: 23,
    fontWeight: fontWeight.semibold,
  },
  titleSm: {
    fontFamily: fontFamilyMedium,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: fontWeight.semibold,
  },
  body: { fontFamily, fontSize: 15, lineHeight: 22, fontWeight: fontWeight.regular },
  bodySm: { fontFamily, fontSize: 13, lineHeight: 19, fontWeight: fontWeight.regular },
  label: {
    fontFamily: fontFamilyMedium,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: fontWeight.medium,
    letterSpacing: 0.1,
  },
  caption: {
    fontFamily,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: fontWeight.medium,
    letterSpacing: 0.3,
  },
  // Tabular-ish figures for money and running clocks, so digits do not jitter.
  numeric: {
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
    fontSize: 15,
    lineHeight: 20,
    fontWeight: fontWeight.medium,
  },
} as const satisfies Record<TypographyVariant, TextStyle>;

export interface ElevationStyle {
  readonly shadowColor: string;
  readonly shadowOffset: { width: number; height: number };
  readonly shadowOpacity: number;
  readonly shadowRadius: number;
  readonly elevation: number;
}

/** Shadows are subtle by design; the UI leans on borders and surface steps. */
export function elevation(level: 0 | 1 | 2 | 3, shadowColor: string): ElevationStyle {
  const levels: Record<0 | 1 | 2 | 3, Omit<ElevationStyle, 'shadowColor'>> = {
    0: { shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0, shadowRadius: 0, elevation: 0 },
    1: {
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.06,
      shadowRadius: 3,
      elevation: 1,
    },
    2: {
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.1,
      shadowRadius: 10,
      elevation: 4,
    },
    3: {
      shadowOffset: { width: 0, height: 10 },
      shadowOpacity: 0.14,
      shadowRadius: 22,
      elevation: 10,
    },
  };
  return { shadowColor, ...levels[level] };
}

export const motion = {
  fast: 120,
  normal: 200,
  slow: 320,
} as const;
