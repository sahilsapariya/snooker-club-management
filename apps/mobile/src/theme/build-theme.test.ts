import { buildTheme, DEFAULT_BRANDING, type Branding } from './build-theme';
import { contrastRatio, ensureContrast, hexToRgb, mix, readableForeground } from './color';
import { THEME_PRESETS } from './presets';

/**
 * The theme system's job is to take one arbitrary brand colour from the
 * platform admin and produce a UI that is still readable. These tests pin that
 * down, because "looks fine on my emerald test club" is not a guarantee.
 */

const brandingFor = (primaryColor: string): Branding => ({
  primaryColor,
  secondaryColor: null,
  logoUrl: null,
  clubName: 'Test Club',
});

describe('colour maths', () => {
  it('parses both short and long hex forms', () => {
    expect(hexToRgb('#fff')).toEqual({ r: 255, g: 255, b: 255 });
    expect(hexToRgb('059669')).toEqual({ r: 5, g: 150, b: 105 });
    expect(hexToRgb('not-a-colour')).toBeNull();
  });

  it('computes WCAG contrast ratios', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
  });

  it('picks the readable foreground for light and dark backgrounds', () => {
    expect(readableForeground('#0b1220')).toBe('#ffffff');
    expect(readableForeground('#fbbf24')).toBe('#0B1220');
  });

  it('nudges a colour until it meets the requested contrast', () => {
    // Pale amber on white is unreadable as text.
    expect(contrastRatio('#fde68a', '#ffffff')).toBeLessThan(4.5);
    const adjusted = ensureContrast('#fde68a', '#ffffff', 4.5);
    expect(contrastRatio(adjusted, '#ffffff')).toBeGreaterThanOrEqual(4.5);
  });

  it('blends towards the target colour', () => {
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mix('#000000', '#ffffff', 0)).toBe('#000000');
    expect(mix('#000000', '#ffffff', 1)).toBe('#ffffff');
  });
});

describe('buildTheme', () => {
  it.each(['light', 'dark'] as const)('keeps body text readable in %s mode', (scheme) => {
    const theme = buildTheme(DEFAULT_BRANDING, scheme);
    // WCAG AA for normal text.
    expect(contrastRatio(theme.colors.textPrimary, theme.colors.surface)).toBeGreaterThanOrEqual(
      4.5,
    );
    expect(contrastRatio(theme.colors.textSecondary, theme.colors.surface)).toBeGreaterThanOrEqual(
      4.5,
    );
    expect(contrastRatio(theme.colors.textPrimary, theme.colors.background)).toBeGreaterThanOrEqual(
      4.5,
    );
  });

  // The six palettes the product is specified to support, plus two awkward
  // extremes: an almost-black brand and a very pale one.
  const brandColors = [...THEME_PRESETS.map((preset) => preset.primaryColor), '#000000', '#fde68a'];

  it.each(brandColors)('produces a legible primary button for brand %s', (primary) => {
    for (const scheme of ['light', 'dark'] as const) {
      const theme = buildTheme(brandingFor(primary), scheme);
      expect(
        contrastRatio(theme.colors.primaryForeground, theme.colors.primary),
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each(brandColors)('produces a legible brand accent on surface for %s', (primary) => {
    for (const scheme of ['light', 'dark'] as const) {
      const theme = buildTheme(brandingFor(primary), scheme);
      expect(
        contrastRatio(theme.colors.primaryOnSurface, theme.colors.surface),
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrastRatio(theme.colors.onPrimaryContainer, theme.colors.primaryContainer),
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each(brandColors)('keeps status colours independent of the brand colour %s', (primary) => {
    const emerald = buildTheme(brandingFor('#059669'), 'light');
    const branded = buildTheme(brandingFor(primary), 'light');

    // Red must mean "unpaid" in every club, including one whose brand is green.
    // Status hues are allowed to shift a little for contrast against a tinted
    // surface, but they must not track the brand colour.
    expect(branded.colors.error).not.toBe(branded.colors.primary);
    expect(branded.colors.success).not.toBe(branded.colors.primary);
    expect(contrastRatio(branded.colors.error, emerald.colors.error)).toBeLessThan(1.6);
  });

  it.each(brandColors)('keeps status containers readable for brand %s', (primary) => {
    for (const scheme of ['light', 'dark'] as const) {
      const theme = buildTheme(brandingFor(primary), scheme);
      const pairs = [
        [theme.colors.onSuccessContainer, theme.colors.successContainer],
        [theme.colors.onWarningContainer, theme.colors.warningContainer],
        [theme.colors.onErrorContainer, theme.colors.errorContainer],
        [theme.colors.onInfoContainer, theme.colors.infoContainer],
      ] as const;

      for (const [foreground, background] of pairs) {
        expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('falls back to the default brand colour when given nonsense', () => {
    const theme = buildTheme(brandingFor('definitely-not-hex'), 'light');
    expect(theme.colors.primary).toBe(DEFAULT_BRANDING.primaryColor);
  });

  it('is deterministic for the same input', () => {
    const a = buildTheme(brandingFor('#9f1239'), 'dark');
    const b = buildTheme(brandingFor('#9f1239'), 'dark');
    expect(a.colors).toEqual(b.colors);
  });
});
