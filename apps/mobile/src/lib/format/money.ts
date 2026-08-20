/**
 * Money formatting.
 *
 * Amounts travel and are stored as INTEGER MINOR UNITS (paise, cents) in
 * `bigint` columns. They are never converted to a float anywhere in this file:
 * the integer is split into whole and fractional parts with integer arithmetic,
 * so 1/3-of-a-rupee rounding drift is impossible by construction.
 */
export interface CurrencyConfig {
  /** ISO 4217 code, e.g. `INR`. */
  readonly code: string;
  /** Digits after the decimal separator: 2 for INR/USD, 0 for JPY. */
  readonly minorUnits: number;
}

export const DEFAULT_CURRENCY: CurrencyConfig = { code: 'INR', minorUnits: 2 };

/**
 * Symbols for the currencies this product realistically serves. Anything else
 * falls back to the ISO code, which is always correct if less pretty.
 *
 * Deliberately not `Intl.NumberFormat`: Hermes ships a reduced ICU dataset that
 * varies by platform and build, and money is not something to render
 * differently on iOS than on Android.
 */
const CURRENCY_SYMBOLS: Readonly<Record<string, string>> = {
  INR: '₹',
  USD: '$',
  EUR: '€',
  GBP: '£',
  AED: 'AED ',
  AUD: 'A$',
  CAD: 'C$',
  LKR: 'Rs ',
  NPR: 'Rs ',
  PKR: 'Rs ',
  SGD: 'S$',
  MYR: 'RM',
  ZAR: 'R',
};

export function currencySymbol(code: string): string {
  return CURRENCY_SYMBOLS[code.toUpperCase()] ?? `${code.toUpperCase()} `;
}

/** Groups digits in the Indian lakh/crore style for INR, thousands otherwise. */
function groupDigits(digits: string, code: string): string {
  if (digits.length <= 3) return digits;

  const usesIndianGrouping = code === 'INR' || code === 'LKR' || code === 'NPR' || code === 'PKR';
  if (!usesIndianGrouping) {
    return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  const lastThree = digits.slice(-3);
  const rest = digits.slice(0, -3);
  return `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${lastThree}`;
}

export interface FormatMoneyOptions {
  readonly currency?: CurrencyConfig;
  /** Render the currency symbol. Default true. */
  readonly withSymbol?: boolean;
  /** Drop the fractional part when it is zero (`1,250` rather than `1,250.00`). */
  readonly compactZeroFraction?: boolean;
}

/**
 * Formats an integer amount of minor units for display.
 *
 * `formatMoney(125050)` -> `Rs 1,250.50`
 */
export function formatMoney(amountMinor: number, options: FormatMoneyOptions = {}): string {
  const currency = options.currency ?? DEFAULT_CURRENCY;
  const withSymbol = options.withSymbol ?? true;

  const safeAmount = Number.isFinite(amountMinor) ? Math.trunc(amountMinor) : 0;
  const negative = safeAmount < 0;
  const absolute = Math.abs(safeAmount);

  const divisor = 10 ** currency.minorUnits;
  const whole = Math.floor(absolute / divisor);
  const fraction = absolute % divisor;

  const wholeText = groupDigits(String(whole), currency.code.toUpperCase());
  const showFraction =
    currency.minorUnits > 0 && !(options.compactZeroFraction === true && fraction === 0);

  const numberText = showFraction
    ? `${wholeText}.${String(fraction).padStart(currency.minorUnits, '0')}`
    : wholeText;

  const symbol = withSymbol ? currencySymbol(currency.code) : '';
  return `${negative ? '-' : ''}${symbol}${numberText}`;
}

/** Parses user input such as `1,250.50` into minor units. Returns null if unparseable. */
export function parseMoneyToMinor(
  input: string,
  currency: CurrencyConfig = DEFAULT_CURRENCY,
): number | null {
  const cleaned = input.replace(/[^0-9.\-]/g, '').trim();
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return null;

  const negative = cleaned.startsWith('-');
  const unsigned = negative ? cleaned.slice(1) : cleaned;

  const parts = unsigned.split('.');
  if (parts.length > 2) return null;

  const wholePart = parts[0] ?? '0';
  const fractionPart = parts[1] ?? '';
  if (!/^\d*$/.test(wholePart) || !/^\d*$/.test(fractionPart)) return null;

  const paddedFraction = fractionPart
    .slice(0, currency.minorUnits)
    .padEnd(currency.minorUnits, '0');

  const minor =
    Number.parseInt(wholePart === '' ? '0' : wholePart, 10) * 10 ** currency.minorUnits +
    Number.parseInt(paddedFraction === '' ? '0' : paddedFraction, 10);

  if (!Number.isSafeInteger(minor)) return null;
  return negative ? -minor : minor;
}
