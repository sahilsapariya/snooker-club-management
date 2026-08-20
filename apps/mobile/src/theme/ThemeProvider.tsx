import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';

import {
  buildTheme,
  DEFAULT_BRANDING,
  type Branding,
  type ColorScheme,
  type Theme,
} from './build-theme';
import { findPreset } from './presets';

interface ThemeProviderProps {
  readonly branding?: Branding | null;
  /** Force a scheme; omit to follow the device. */
  readonly scheme?: ColorScheme;
  readonly children: ReactNode;
}

const ThemeContext = createContext<Theme | null>(null);

/**
 * Supplies the active theme to the tree.
 *
 * Branding arrives from the tenant row after sign-in, so the app renders with
 * the product default first and re-themes once the club is known. Because
 * components only read semantic tokens, that transition needs no component to
 * be aware of it.
 */
export function ThemeProvider({ branding, scheme, children }: ThemeProviderProps) {
  const deviceScheme = useColorScheme();
  const activeScheme: ColorScheme = scheme ?? (deviceScheme === 'dark' ? 'dark' : 'light');

  const theme = useMemo(
    () => buildTheme(branding ?? DEFAULT_BRANDING, activeScheme),
    [branding, activeScheme],
  );

  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  const theme = useContext(ThemeContext);
  if (!theme) {
    throw new Error('useTheme must be used inside a <ThemeProvider>.');
  }
  return theme;
}

/**
 * Resolves a tenant row into `Branding`.
 *
 * Precedence: an explicit `primary_color` beats the named preset, because the
 * preset is only a convenient starting point for the platform admin.
 */
export function brandingFromTenant(tenant: {
  name: string;
  logo_url: string | null;
  primary_color: string;
  secondary_color: string | null;
  theme_preset: string | null;
}): Branding {
  const preset = findPreset(tenant.theme_preset);
  return {
    clubName: tenant.name,
    logoUrl: tenant.logo_url,
    primaryColor: tenant.primary_color || preset?.primaryColor || DEFAULT_BRANDING.primaryColor,
    secondaryColor: tenant.secondary_color ?? preset?.secondaryColor ?? null,
  };
}
