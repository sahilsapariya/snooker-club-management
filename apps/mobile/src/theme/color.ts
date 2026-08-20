/**
 * Colour maths for the theme system.
 *
 * The platform super admin picks one brand colour per club and the whole UI is
 * derived from it. That only works if derivation is principled, so contrast is
 * computed (WCAG relative luminance) rather than eyeballed - a club that
 * chooses a pale amber must not end up with white text on it.
 */
export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

const HEX_PATTERN = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

export function hexToRgb(hex: string): Rgb | null {
  const match = HEX_PATTERN.exec(hex.trim());
  if (!match) return null;

  const body = match[1] ?? '';
  const full =
    body.length === 3
      ? body
          .split('')
          .map((char) => char + char)
          .join('')
      : body;

  return {
    r: Number.parseInt(full.slice(0, 2), 16),
    g: Number.parseInt(full.slice(2, 4), 16),
    b: Number.parseInt(full.slice(4, 6), 16),
  };
}

function clampChannel(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const toHex = (value: number): string => clampChannel(value).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function isValidHexColor(value: string): boolean {
  return HEX_PATTERN.test(value.trim());
}

/** WCAG 2.1 relative luminance. */
export function relativeLuminance(color: Rgb): number {
  const channel = (raw: number): number => {
    const normalised = raw / 255;
    return normalised <= 0.03928 ? normalised / 12.92 : ((normalised + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
}

/** WCAG contrast ratio, 1 (identical) to 21 (black on white). */
export function contrastRatio(a: string, b: string): number {
  const rgbA = hexToRgb(a);
  const rgbB = hexToRgb(b);
  if (!rgbA || !rgbB) return 1;

  const lumA = relativeLuminance(rgbA);
  const lumB = relativeLuminance(rgbB);
  const lighter = Math.max(lumA, lumB);
  const darker = Math.min(lumA, lumB);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Linear blend in sRGB. `amount` is how much of `to` ends up in the result. */
export function mix(from: string, to: string, amount: number): string {
  const rgbFrom = hexToRgb(from);
  const rgbTo = hexToRgb(to);
  if (!rgbFrom || !rgbTo) return from;

  const ratio = Math.max(0, Math.min(1, amount));
  return rgbToHex({
    r: rgbFrom.r + (rgbTo.r - rgbFrom.r) * ratio,
    g: rgbFrom.g + (rgbTo.g - rgbFrom.g) * ratio,
    b: rgbFrom.b + (rgbTo.b - rgbFrom.b) * ratio,
  });
}

export function lighten(color: string, amount: number): string {
  return mix(color, '#ffffff', amount);
}

export function darken(color: string, amount: number): string {
  return mix(color, '#000000', amount);
}

/** `rgba()` string, for overlays and pressed states. */
export function withAlpha(color: string, alpha: number): string {
  const rgb = hexToRgb(color);
  if (!rgb) return color;
  const clamped = Math.max(0, Math.min(1, alpha));
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${clamped})`;
}

/**
 * The better of two foreground colours for text sitting on `background`.
 * This is what stops a light brand colour from getting white text on it.
 */
export function readableForeground(
  background: string,
  light = '#ffffff',
  dark = '#0B1220',
): string {
  return contrastRatio(background, light) >= contrastRatio(background, dark) ? light : dark;
}

/**
 * Nudges `color` until it reads acceptably against `background`.
 *
 * Used where a brand colour has to act as text or an icon rather than as a
 * filled surface. A club that picks a pale yellow still gets a legible accent;
 * the hue is preserved, only the lightness moves.
 */
export function ensureContrast(color: string, background: string, minRatio = 4.5): string {
  if (contrastRatio(color, background) >= minRatio) return color;

  const backgroundRgb = hexToRgb(background);
  if (!backgroundRgb) return color;

  // Darken against a light background, lighten against a dark one.
  const target = relativeLuminance(backgroundRgb) > 0.4 ? '#000000' : '#ffffff';

  let candidate = color;
  for (let step = 1; step <= 20; step += 1) {
    candidate = mix(color, target, step * 0.05);
    if (contrastRatio(candidate, background) >= minRatio) return candidate;
  }
  return candidate;
}
