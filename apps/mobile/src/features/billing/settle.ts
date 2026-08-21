import type { Database } from '@/types/database.types';

export type PaymentStatus = Database['public']['Enums']['payment_status'];
export type PaymentMethod = Database['public']['Enums']['payment_method'];

export interface SettlementInput {
  /** Table charge produced by the billing engine. */
  readonly tableChargeMinor: number;
  /** Sum of the session's line items. */
  readonly itemsTotalMinor: number;
  /** Goodwill reduction. Cannot exceed charges. */
  readonly discountMinor: number;
  /** What the customer actually handed over. */
  readonly tenderedMinor: number;
  /** Written off entirely rather than collected. */
  readonly waived?: boolean;
}

export interface Settlement {
  readonly grossMinor: number;
  readonly discountMinor: number;
  /** What is owed after the discount. Matches `sessions.total_amount_minor`. */
  readonly payableMinor: number;
  /** What to record as collected - never more than is owed. */
  readonly paidAmountMinor: number;
  /** Cash to hand back when the customer over-tenders. */
  readonly changeMinor: number;
  readonly outstandingMinor: number;
  readonly paymentStatus: PaymentStatus;
  /** Populated when an input had to be clamped, so the UI can say why. */
  readonly warnings: readonly string[];
}

/**
 * Turns "what is owed" and "what was handed over" into the row the database
 * expects.
 *
 * Kept pure and separate from the UI because the arithmetic has sharp edges:
 * a discount cannot exceed the bill (a check constraint enforces that, and
 * hitting it is a rejected save rather than a helpful message), over-tendering
 * is change rather than revenue, and the payment status must agree with the
 * amount or `sessions_paid_requires_method` rejects the update.
 *
 * Everything is integer minor units, so nothing here can drift by a paisa.
 */
export function settleSession(input: SettlementInput): Settlement {
  const warnings: string[] = [];

  const grossMinor = Math.max(0, Math.trunc(input.tableChargeMinor + input.itemsTotalMinor));

  let discountMinor = Math.max(0, Math.trunc(input.discountMinor));
  if (discountMinor > grossMinor) {
    // The database would reject this outright; clamping and saying so beats a
    // failed save at the counter.
    discountMinor = grossMinor;
    warnings.push('The discount cannot be more than the bill, so it was capped.');
  }

  const payableMinor = grossMinor - discountMinor;

  if (input.waived === true) {
    return {
      grossMinor,
      discountMinor,
      payableMinor,
      paidAmountMinor: 0,
      changeMinor: 0,
      outstandingMinor: 0,
      paymentStatus: 'WAIVED',
      warnings,
    };
  }

  const tenderedMinor = Math.max(0, Math.trunc(input.tenderedMinor));
  const paidAmountMinor = Math.min(tenderedMinor, payableMinor);
  const changeMinor = tenderedMinor - paidAmountMinor;
  const outstandingMinor = payableMinor - paidAmountMinor;

  let paymentStatus: PaymentStatus;
  if (payableMinor === 0) {
    // Nothing to collect - a fully discounted or zero-value session counts as
    // settled rather than sitting in the unpaid list forever.
    paymentStatus = 'PAID';
  } else if (paidAmountMinor === 0) {
    paymentStatus = 'UNPAID';
  } else if (outstandingMinor > 0) {
    paymentStatus = 'PARTIALLY_PAID';
  } else {
    paymentStatus = 'PAID';
  }

  if (changeMinor > 0) {
    warnings.push('More was tendered than owed; the difference is change, not revenue.');
  }

  return {
    grossMinor,
    discountMinor,
    payableMinor,
    paidAmountMinor,
    changeMinor,
    outstandingMinor,
    paymentStatus,
    warnings,
  };
}

/**
 * A payment method is mandatory once anything has been collected -
 * `sessions_paid_requires_method` rejects a PAID row without one.
 */
export function paymentMethodFor(
  settlement: Settlement,
  chosen: PaymentMethod,
): PaymentMethod | null {
  if (settlement.paymentStatus === 'WAIVED') return null;
  return settlement.paidAmountMinor > 0 ? chosen : null;
}
