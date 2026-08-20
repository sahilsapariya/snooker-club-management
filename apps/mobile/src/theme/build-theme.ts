import {
  darken,
  ensureContrast,
  isValidHexColor,
  lighten,
  mix,
  readableForeground,
  withAlpha,
} from './color';
import {
  elevation,
  motion,
  radius,
  spacing,
  touchTarget,
  typography,
  type ElevationStyle,
} from './tokens';

export type ColorScheme = 'light' | 'dark';

/**
 * The branding a tenant carries, as set by the platform super admin.
 * Club staff never supply these; they arrive with the tenant row.
 */
export interface Branding {
  readonly primaryColor: string;
  readonly secondaryColor: string | null;
  readonly logoUrl: string | null;
  readonly clubName: string;
}

export const DEFAULT_BRANDING: Branding = {
  // Emerald: the product's own default identity.
  primaryColor: '#059669',
  secondaryColor: '#0F766E',
  logoUrl: null,
  clubName: 'Club Desk',
};

/**
 * Semantic colour tokens.
 *
 * Components only ever reference these names. That is what lets the same screen
 * render an emerald club, a midnight-black club and a burgundy club without a
 * single component knowing which.
 */
export interface ThemeColors {
  readonly background: string;
  readonly surface: string;
  readonly surfaceElevated: string;
  readonly surfaceSunken: string;

  readonly textPrimary: string;
  readonly textSecondary: string;
  readonly textMuted: string;
  readonly textInverse: string;

  readonly primary: string;
  readonly primaryForeground: string;
  readonly primaryContainer: string;
  readonly onPrimaryContainer: string;
  /** Brand colour adjusted to be legible as text/icons on `surface`. */
  readonly primaryOnSurface: string;
  readonly primaryPressed: string;

  readonly secondary: string;
  readonly secondaryForeground: string;

  readonly border: string;
  readonly borderStrong: string;
  readonly divider: string;

  /**
   * Status colours are FIXED, never derived from the club's brand. Red has to
   * mean "unpaid" in every club, including the one whose brand colour is red.
   */
  readonly success: string;
  readonly successContainer: string;
  readonly onSuccessContainer: string;
  readonly warning: string;
  readonly warningContainer: string;
  readonly onWarningContainer: string;
  readonly error: string;
  readonly errorContainer: string;
  readonly onErrorContainer: string;
  readonly info: string;
  readonly infoContainer: string;
  readonly onInfoContainer: string;

  readonly overlay: string;
  readonly skeleton: string;
  readonly shadow: string;
}

export interface Theme {
  readonly scheme: ColorScheme;
  readonly colors: ThemeColors;
  readonly spacing: typeof spacing;
  readonly radius: typeof radius;
  readonly typography: typeof typography;
  readonly touchTarget: typeof touchTarget;
  readonly motion: typeof motion;
  readonly branding: Branding;
  elevation(level: 0 | 1 | 2 | 3): ElevationStyle;
}

/** Neutral ramps. Brand hue is blended in lightly so surfaces feel cohesive. */
const LIGHT_NEUTRALS = {
  background: '#F5F7F9',
  surface: '#FFFFFF',
  surfaceElevated: '#FFFFFF',
  surfaceSunken: '#EDF1F4',
  textPrimary: '#0F172A',
  textSecondary: '#475569',
  textMuted: '#7C8798',
  border: '#E2E8F0',
  borderStrong: '#CBD5E1',
} as const;

const DARK_NEUTRALS = {
  background: '#0B1220',
  surface: '#141C2B',
  surfaceElevated: '#1B2436',
  surfaceSunken: '#080D17',
  textPrimary: '#F1F5F9',
  textSecondary: '#B2BECD',
  textMuted: '#7A8798',
  border: '#26324A',
  borderStrong: '#38455E',
} as const;

/** Status palette per scheme. Independent of branding, on purpose. */
const STATUS = {
  light: {
    success: '#0F9D58',
    warning: '#B45309',
    error: '#DC2626',
    info: '#2563EB',
  },
  dark: {
    success: '#34D399',
    warning: '#FBBF24',
    error: '#F87171',
    info: '#60A5FA',
  },
} as const;

function normaliseHex(value: string | null | undefined, fallback: string): string {
  if (typeof value === 'string' && isValidHexColor(value)) {
    return value.startsWith('#') ? value.toLowerCase() : `#${value.toLowerCase()}`;
  }
  return fallback;
}

/**
 * Builds the full token set for one club and one colour scheme.
 *
 * Pure and cheap: given the same branding it returns the same theme, so it can
 * be memoised on the tenant row without any caching machinery.
 */
export function buildTheme(branding: Branding, scheme: ColorScheme): Theme {
  const primary = normaliseHex(branding.primaryColor, DEFAULT_BRANDING.primaryColor);
  const secondary = normaliseHex(branding.secondaryColor, primary);

  const neutrals = scheme === 'light' ? LIGHT_NEUTRALS : DARK_NEUTRALS;
  const status = STATUS[scheme];
  const isLight = scheme === 'light';

  // A whisper of brand hue in the neutrals. Kept very low so contrast ratios
  // computed against the plain ramp stay valid.
  const tint = (base: string, amount: number): string => mix(base, primary, amount);

  const background = tint(neutrals.background, isLight ? 0.03 : 0.04);
  const surface = tint(neutrals.surface, isLight ? 0.015 : 0.05);
  const surfaceElevated = tint(neutrals.surfaceElevated, isLight ? 0.01 : 0.07);
  const surfaceSunken = tint(neutrals.surfaceSunken, isLight ? 0.04 : 0.03);

  const primaryForeground = readableForeground(primary);
  const secondaryForeground = readableForeground(secondary);

  const primaryContainer = isLight ? mix(surface, primary, 0.12) : mix(surface, primary, 0.22);
  const onPrimaryContainer = ensureContrast(
    isLight ? darken(primary, 0.25) : lighten(primary, 0.55),
    primaryContainer,
    4.5,
  );

  const containerFor = (color: string): string =>
    isLight ? mix(surface, color, 0.12) : mix(surface, color, 0.2);
  const onContainerFor = (color: string, container: string): string =>
    ensureContrast(isLight ? darken(color, 0.2) : lighten(color, 0.35), container, 4.5);

  const successContainer = containerFor(status.success);
  const warningContainer = containerFor(status.warning);
  const errorContainer = containerFor(status.error);
  const infoContainer = containerFor(status.info);

  const colors: ThemeColors = {
    background,
    surface,
    surfaceElevated,
    surfaceSunken,

    textPrimary: neutrals.textPrimary,
    textSecondary: neutrals.textSecondary,
    textMuted: neutrals.textMuted,
    textInverse: isLight ? '#FFFFFF' : '#0B1220',

    primary,
    primaryForeground,
    primaryContainer,
    onPrimaryContainer,
    primaryOnSurface: ensureContrast(primary, surface, 4.5),
    primaryPressed: isLight ? darken(primary, 0.12) : lighten(primary, 0.12),

    secondary,
    secondaryForeground,

    border: tint(neutrals.border, isLight ? 0.05 : 0.06),
    borderStrong: tint(neutrals.borderStrong, isLight ? 0.05 : 0.06),
    divider: withAlpha(neutrals.borderStrong, isLight ? 0.6 : 0.5),

    success: ensureContrast(status.success, surface, 3),
    successContainer,
    onSuccessContainer: onContainerFor(status.success, successContainer),
    warning: ensureContrast(status.warning, surface, 3),
    warningContainer,
    onWarningContainer: onContainerFor(status.warning, warningContainer),
    error: ensureContrast(status.error, surface, 3),
    errorContainer,
    onErrorContainer: onContainerFor(status.error, errorContainer),
    info: ensureContrast(status.info, surface, 3),
    infoContainer,
    onInfoContainer: onContainerFor(status.info, infoContainer),

    overlay: withAlpha('#000000', isLight ? 0.4 : 0.6),
    skeleton: isLight ? mix(surface, '#000000', 0.06) : mix(surface, '#ffffff', 0.06),
    shadow: isLight ? '#0F172A' : '#000000',
  };

  return {
    scheme,
    colors,
    spacing,
    radius,
    typography,
    touchTarget,
    motion,
    branding: { ...branding, primaryColor: primary, secondaryColor: secondary },
    elevation: (level) => elevation(level, colors.shadow),
  };
}
