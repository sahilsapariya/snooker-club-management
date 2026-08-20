import { currencySymbol, formatMoney, parseMoneyToMinor, type CurrencyConfig } from './money';

const INR: CurrencyConfig = { code: 'INR', minorUnits: 2 };
const USD: CurrencyConfig = { code: 'USD', minorUnits: 2 };
const JPY: CurrencyConfig = { code: 'JPY', minorUnits: 0 };

describe('formatMoney', () => {
  it('renders minor units as a decimal amount', () => {
    expect(formatMoney(125050, { currency: INR })).toBe('₹1,250.50');
    expect(formatMoney(0, { currency: INR })).toBe('₹0.00');
    expect(formatMoney(5, { currency: INR })).toBe('₹0.05');
  });

  it('uses lakh grouping for INR and thousands grouping elsewhere', () => {
    expect(formatMoney(1234567890, { currency: INR })).toBe('₹1,23,45,678.90');
    expect(formatMoney(1234567890, { currency: USD })).toBe('$12,345,678.90');
  });

  it('honours currencies with no minor units', () => {
    expect(formatMoney(1500, { currency: JPY })).toBe('JPY 1,500');
  });

  it('renders negative amounts with the sign outside the symbol', () => {
    expect(formatMoney(-50000, { currency: INR })).toBe('-₹500.00');
  });

  it('can drop a zero fraction and the symbol', () => {
    expect(formatMoney(125000, { currency: INR, compactZeroFraction: true })).toBe('₹1,250');
    expect(formatMoney(125050, { currency: INR, withSymbol: false })).toBe('1,250.50');
  });

  it('never produces floating point drift', () => {
    // 0.1 + 0.2 territory: these are exact because the maths stays integral.
    expect(formatMoney(10 + 20, { currency: INR })).toBe('₹0.30');
    expect(formatMoney(999999999, { currency: INR, withSymbol: false })).toBe('99,99,999.99');
  });

  it('falls back to the ISO code for unknown currencies', () => {
    expect(currencySymbol('XYZ')).toBe('XYZ ');
  });
});

describe('parseMoneyToMinor', () => {
  it('parses plain and grouped input', () => {
    expect(parseMoneyToMinor('1250.50', INR)).toBe(125050);
    expect(parseMoneyToMinor('1,250.50', INR)).toBe(125050);
    expect(parseMoneyToMinor('₹1,250', INR)).toBe(125000);
  });

  it('pads and truncates the fraction to the currency precision', () => {
    expect(parseMoneyToMinor('10.5', INR)).toBe(1050);
    expect(parseMoneyToMinor('10.567', INR)).toBe(1056);
    expect(parseMoneyToMinor('10.99', JPY)).toBe(10);
  });

  it('rejects input that is not a number', () => {
    expect(parseMoneyToMinor('', INR)).toBeNull();
    expect(parseMoneyToMinor('abc', INR)).toBeNull();
    expect(parseMoneyToMinor('1.2.3', INR)).toBeNull();
  });

  it('round-trips through formatMoney', () => {
    for (const amount of [0, 1, 99, 100, 123456, 98765432]) {
      const text = formatMoney(amount, { currency: INR, withSymbol: false });
      expect(parseMoneyToMinor(text, INR)).toBe(amount);
    }
  });
});
