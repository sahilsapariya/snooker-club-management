import type { Database } from '@/types/database.types';

export type BillingSettings = Database['public']['Tables']['tenant_billing_settings']['Row'];
export type PricingRule = Database['public']['Tables']['pricing_rules']['Row'];

export type TimeCalculationMode = Database['public']['Enums']['time_calculation_mode'];
export type RoundingMode = Database['public']['Enums']['rounding_mode'];
export type OvertimeMode = Database['public']['Enums']['overtime_mode'];
export type PricingMode = Database['public']['Enums']['pricing_mode'];

/**
 * The recorded facts of a session, as the billing engine sees them.
 *
 * Deliberately not the whole `sessions` row: the engine takes only what it is
 * allowed to reason about. It cannot see `actual_duration_seconds` (a generated
 * column) or any previously computed charge, so it can never feed its own
 * output back in.
 */
export interface SessionFacts {
  /** ISO timestamp the session actually started. */
  readonly startedAt: string;
  /** ISO timestamp it actually ended, or null while still running. */
  readonly endedAt: string | null;
  /** Booked duration, if the club sold a fixed slot. */
  readonly plannedDurationMinutes: number | null;
  /** Frames played, for clubs that bill per frame. */
  readonly framesPlayed: number;
}

/** One line of the explanation shown to staff and stored on the session. */
export interface ChargeLine {
  readonly label: string;
  readonly detail: string;
  readonly amountMinor: number;
}

/**
 * What the engine produces.
 *
 * `actualSeconds` is echoed back for display only. The database computes its
 * own `actual_duration_seconds` from the timestamps and will not accept a value
 * from here.
 */
export interface ChargeResult {
  /** Real elapsed time. Never modified by any billing rule. */
  readonly actualSeconds: number;
  /** Time the club has decided to charge for. Independent of the above. */
  readonly billableSeconds: number;

  readonly regularMinutes: number;
  readonly overtimeMinutes: number;
  /** Minutes forgiven by the grace period. */
  readonly graceMinutes: number;

  readonly regularChargeMinor: number;
  readonly overtimeChargeMinor: number;
  readonly frameChargeMinor: number;
  readonly tableChargeMinor: number;

  /** Human-readable breakdown, safe to render or persist for audit. */
  readonly lines: readonly ChargeLine[];
  /** Notes about rules that fired, e.g. a minimum being applied. */
  readonly notes: readonly string[];
}

/** A single band in `tenant_billing_settings.custom_slabs`. */
export interface CustomSlab {
  /** Upper bound in minutes, inclusive. `null` means "and everything above". */
  readonly up_to_minutes: number | null;
  readonly price_minor: number;
}
