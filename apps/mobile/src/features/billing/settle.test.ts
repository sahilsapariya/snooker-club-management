import { paymentMethodFor, settleSession } from './settle';

/**
 * Settlement has to agree with two database constraints or the save is
 * rejected at the counter:
 *   sessions_discount_within_charges  discount <= table charge + items
 *   sessions_paid_requires_method     PAID implies a payment method
 * These tests pin both, plus the money arithmetic around change and part
 * payments.
 */

const bill = (over: Partial<Parameters<typeof settleSession>[0]> = {}) =>
  settleSession({
    tableChargeMinor: 30000,
    itemsTotalMinor: 10500,
    discountMinor: 0,
    tenderedMinor: 0,
    ...over,
  });

describe('settleSession', () => {
  it('adds table time and items into the gross bill', () => {
    const s = bill();
    expect(s.grossMinor).toBe(40500);
    expect(s.payableMinor).toBe(40500);
  });

  it('marks an untouched bill unpaid', () => {
    const s = bill();
    expect(s.paymentStatus).toBe('UNPAID');
    expect(s.outstandingMinor).toBe(40500);
  });

  it('settles a bill paid in full', () => {
    const s = bill({ tenderedMinor: 40500 });
    expect(s.paymentStatus).toBe('PAID');
    expect(s.paidAmountMinor).toBe(40500);
    expect(s.outstandingMinor).toBe(0);
    expect(s.changeMinor).toBe(0);
  });

  it('records a part payment and what is still owed', () => {
    const s = bill({ tenderedMinor: 20000 });
    expect(s.paymentStatus).toBe('PARTIALLY_PAID');
    expect(s.paidAmountMinor).toBe(20000);
    expect(s.outstandingMinor).toBe(20500);
  });

  /** Over-tendering is change in the drawer, not revenue on the books. */
  it('treats an over-payment as change rather than income', () => {
    const s = bill({ tenderedMinor: 50000 });
    expect(s.paidAmountMinor).toBe(40500);
    expect(s.changeMinor).toBe(9500);
    expect(s.paymentStatus).toBe('PAID');
    expect(s.warnings.join(' ')).toMatch(/change, not revenue/);
  });

  it('applies a discount before working out what is owed', () => {
    const s = bill({ discountMinor: 5000, tenderedMinor: 35500 });
    expect(s.payableMinor).toBe(35500);
    expect(s.paymentStatus).toBe('PAID');
    expect(s.changeMinor).toBe(0);
  });

  /**
   * `sessions_discount_within_charges` would reject this. Clamping with a
   * warning beats a failed save while a customer waits.
   */
  it('caps a discount at the bill instead of letting the database reject it', () => {
    const s = bill({ discountMinor: 999999 });
    expect(s.discountMinor).toBe(40500);
    expect(s.payableMinor).toBe(0);
    expect(s.warnings.join(' ')).toMatch(/cannot be more than the bill/);
  });

  it('counts a fully discounted bill as settled, not as unpaid forever', () => {
    const s = bill({ discountMinor: 40500 });
    expect(s.payableMinor).toBe(0);
    expect(s.paymentStatus).toBe('PAID');
    expect(s.outstandingMinor).toBe(0);
  });

  it('waives a bill without recording money that never arrived', () => {
    const s = bill({ waived: true });
    expect(s.paymentStatus).toBe('WAIVED');
    expect(s.paidAmountMinor).toBe(0);
    expect(s.outstandingMinor).toBe(0);
  });

  it('never produces a negative amount from nonsense input', () => {
    const s = settleSession({
      tableChargeMinor: -100,
      itemsTotalMinor: -50,
      discountMinor: -10,
      tenderedMinor: -5,
    });
    expect(s.grossMinor).toBe(0);
    expect(s.payableMinor).toBe(0);
    expect(s.paidAmountMinor).toBe(0);
    expect(s.changeMinor).toBe(0);
  });

  it('keeps every amount an integer', () => {
    const s = bill({ discountMinor: 1234.7, tenderedMinor: 999.9 });
    for (const value of [
      s.grossMinor,
      s.discountMinor,
      s.payableMinor,
      s.paidAmountMinor,
      s.changeMinor,
    ]) {
      expect(Number.isInteger(value)).toBe(true);
    }
  });
});

describe('paymentMethodFor', () => {
  it('requires a method once money has been taken', () => {
    expect(paymentMethodFor(bill({ tenderedMinor: 40500 }), 'CASH')).toBe('CASH');
    expect(paymentMethodFor(bill({ tenderedMinor: 100 }), 'UPI')).toBe('UPI');
  });

  it('sends no method when nothing was collected', () => {
    // A method on an UNPAID row would claim money moved when it did not.
    expect(paymentMethodFor(bill(), 'CASH')).toBeNull();
    expect(paymentMethodFor(bill({ waived: true }), 'CASH')).toBeNull();
  });
});
