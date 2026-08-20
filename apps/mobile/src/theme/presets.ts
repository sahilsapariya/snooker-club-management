/**
 * Named brand presets.
 *
 * A tenant row may carry `theme_preset` (a name from this list) and/or an
 * explicit `primary_color`. The explicit colour always wins; the preset exists
 * so the platform admin can pick a well-balanced pair in one click rather than
 * hand-tuning two hex values.
 *
 * These six cover the palettes the product is specified to support. Adding a
 * seventh is a data change here, not a component change anywhere.
 */
export interface ThemePreset {
  readonly id: string;
  readonly label: string;
  readonly primaryColor: string;
  readonly secondaryColor: string;
}

export const THEME_PRESETS: readonly ThemePreset[] = [
  { id: 'emerald', label: 'Emerald', primaryColor: '#059669', secondaryColor: '#0f766e' },
  { id: 'midnight', label: 'Midnight', primaryColor: '#1f2937', secondaryColor: '#4b5563' },
  { id: 'ocean', label: 'Ocean', primaryColor: '#2563eb', secondaryColor: '#1e40af' },
  { id: 'amber', label: 'Amber', primaryColor: '#d97706', secondaryColor: '#b45309' },
  { id: 'burgundy', label: 'Burgundy', primaryColor: '#9f1239', secondaryColor: '#6d1029' },
  { id: 'violet', label: 'Violet', primaryColor: '#7c3aed', secondaryColor: '#5b21b6' },
] as const;

export const DEFAULT_PRESET_ID = 'emerald';

export function findPreset(id: string | null | undefined): ThemePreset | null {
  if (!id) return null;
  return THEME_PRESETS.find((preset) => preset.id === id) ?? null;
}
