import type {
  BillingSettings,
  ChargeLine,
  ChargeResult,
  CustomSlab,
  PricingRule,
  SessionFacts,
} from './types';

/**
 * The billing engine.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE RULE THIS FILE EXISTS TO RESPECT
 * ─────────────────────────────────────────────────────────────────────────
 * What happened and what is charged are two different numbers. This function
 * reads `startedAt` / `endedAt` and produces a *billable* duration. It never
 * produces the actual one: `sessions.actual_duration_seconds` is a generated
 * column and Postgres rejects any attempt to write it (SQLSTATE 428C9). A
 * player booked for 60 minutes who plays 67 leaves 4020 seconds on record no
 * matter what grace period, rounding rule or overtime mode decide to charge.
 *
 * Pure by design: no clock, no database, no I/O. Every rule below is therefore
 * provable in a unit test, which matters because a subtle mistake here
 * overcharges real customers for months before anyone notices.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ORDER OF OPERATIONS
 * ─────────────────────────────────────────────────────────────────────────
 *   1. Split elapsed time into a regular portion and an overtime portion,
 *      using the booked duration and the grace period.
 *   2. Apply the minimum billable time to the regular portion.
 *   3. Round the regular portion.
 *   4. Price the regular portion using the time-calculation mode.
 *   5. Price the overtime portion using the overtime mode.
 *   6. Add frame charges where the club bills per frame.
 */
export function calculateSessionCharge(
  facts: SessionFacts,
  settings: BillingSettings,
  pricingRule: PricingRule | null,
  /** Used only when the session is still running, to price it "as of now". */
  now: number = Date.now(),
): ChargeResult {
  const actualSeconds = elapsedSeconds(facts, now);
  const lines: ChargeLine[] = [];
  const notes: string[] = [];

  // ---- Modes that ignore elapsed time entirely ---------------------------
  if (pricingRule?.pricing_mode === 'PER_FRAME') {
    return frameOnlyCharge(facts, settings, pricingRule, actualSeconds, notes);
  }

  if (pricingRule?.pricing_mode === 'FLAT_SESSION') {
    const amount = Math.max(0, pricingRule.rate_minor);
    return {
      actualSeconds,
      billableSeconds: actualSeconds,
      regularMinutes: Math.ceil(actualSeconds / 60),
      overtimeMinutes: 0,
      graceMinutes: 0,
      regularChargeMinor: amount,
      overtimeChargeMinor: 0,
      frameChargeMinor: 0,
      tableChargeMinor: amount,
      lines: [{ label: 'Flat session rate', detail: pricingRule.name, amountMinor: amount }],
      notes: ['Charged as a flat session fee; elapsed time does not affect the price.'],
    };
  }

  // ---- 1. Split regular vs overtime --------------------------------------
  const { regularSeconds, overtimeSeconds, graceSeconds } = splitOvertime(
    actualSeconds,
    facts.plannedDurationMinutes,
    settings.grace_period_minutes,
  );

  if (graceSeconds > 0) {
    notes.push(
      `Within the ${settings.grace_period_minutes} minute grace period, so the overrun is not charged.`,
    );
  }

  // ---- 2 & 3. Minimum, then rounding -------------------------------------
  let regularMinutes = secondsToMinutes(regularSeconds);

  const minimum = Math.max(settings.minimum_billable_minutes, pricingRule?.minimum_minutes ?? 0);
  if (regularMinutes < minimum) {
    notes.push(`Minimum billable time of ${minimum} minutes applied.`);
    regularMinutes = minimum;
  }

  const roundedMinutes = roundMinutes(
    regularMinutes,
    settings.rounding_mode,
    settings.rounding_increment_minutes,
  );
  if (roundedMinutes !== regularMinutes) {
    notes.push(
      `Rounded ${regularMinutes} min to ${roundedMinutes} min (${describeRounding(settings)}).`,
    );
  }
  regularMinutes = roundedMinutes;

  // ---- 4. Price the regular portion --------------------------------------
  const regularChargeMinor = priceMinutes(regularMinutes, settings, pricingRule);
  if (regularChargeMinor > 0 || regularMinutes > 0) {
    lines.push({
      label: 'Table time',
      detail: `${regularMinutes} min · ${describeMode(settings, pricingRule)}`,
      amountMinor: regularChargeMinor,
    });
  }

  // ---- 5. Price the overtime portion -------------------------------------
  const overtimeMinutes = secondsToMinutes(overtimeSeconds);
  const overtimeChargeMinor = priceOvertime(overtimeMinutes, settings, pricingRule);
  if (overtimeMinutes > 0) {
    lines.push({
      label: 'Overtime',
      detail: `${overtimeMinutes} min · ${describeOvertime(settings)}`,
      amountMinor: overtimeChargeMinor,
    });
    if (settings.overtime_mode === 'FREE') {
      notes.push('This club does not charge for overtime.');
    }
  }

  // ---- 6. Frames on top, where the club bills them separately ------------
  const frameChargeMinor = frameCharge(facts, settings, pricingRule);
  if (frameChargeMinor > 0) {
    lines.push({
      label: 'Frames',
      detail: `${facts.framesPlayed} × ${framePrice(settings, pricingRule)} minor units`,
      amountMinor: frameChargeMinor,
    });
  }

  const tableChargeMinor = regularChargeMinor + overtimeChargeMinor + frameChargeMinor;

  return {
    actualSeconds,
    billableSeconds: (regularMinutes + overtimeMinutes) * 60,
    regularMinutes,
    overtimeMinutes,
    graceMinutes: Math.round(graceSeconds / 60),
    regularChargeMinor,
    overtimeChargeMinor,
    frameChargeMinor,
    tableChargeMinor,
    lines,
    notes,
  };
}

// ===========================================================================
// Steps
// ===========================================================================

function elapsedSeconds(facts: SessionFacts, now: number): number {
  const start = Date.parse(facts.startedAt);
  if (Number.isNaN(start)) return 0;
  const end = facts.endedAt === null ? now : Date.parse(facts.endedAt);
  if (Number.isNaN(end)) return 0;
  return Math.max(0, Math.floor((end - start) / 1000));
}

/**
 * Divides elapsed time into what was booked and what ran over.
 *
 * The grace period forgives an overrun entirely: at 63 minutes against a
 * 60-minute booking with 5 minutes of grace, the customer pays for 60. Once the
 * overrun exceeds the grace, overtime is measured from the end of the booking
 * rather than from the end of the grace - the grace is a courtesy, not a free
 * extension that shifts the meter.
 *
 * A session with no booked duration has no overtime; it is all regular time.
 */
function splitOvertime(
  actualSeconds: number,
  plannedDurationMinutes: number | null,
  gracePeriodMinutes: number,
): { regularSeconds: number; overtimeSeconds: number; graceSeconds: number } {
  if (plannedDurationMinutes === null || plannedDurationMinutes <= 0) {
    return { regularSeconds: actualSeconds, overtimeSeconds: 0, graceSeconds: 0 };
  }

  const plannedSeconds = plannedDurationMinutes * 60;
  const graceAllowance = Math.max(0, gracePeriodMinutes) * 60;

  if (actualSeconds <= plannedSeconds) {
    return { regularSeconds: actualSeconds, overtimeSeconds: 0, graceSeconds: 0 };
  }

  const overrun = actualSeconds - plannedSeconds;
  if (overrun <= graceAllowance) {
    return { regularSeconds: plannedSeconds, overtimeSeconds: 0, graceSeconds: overrun };
  }

  return { regularSeconds: plannedSeconds, overtimeSeconds: overrun, graceSeconds: 0 };
}

/** Whole minutes, rounded up: a started minute is a used minute. */
function secondsToMinutes(seconds: number): number {
  return Math.ceil(Math.max(0, seconds) / 60);
}

function roundMinutes(
  minutes: number,
  mode: BillingSettings['rounding_mode'],
  increment: number,
): number {
  const step = Math.max(1, increment);
  switch (mode) {
    case 'EXACT':
      return minutes;
    case 'ROUND_UP':
      return Math.ceil(minutes / step) * step;
    case 'ROUND_DOWN':
      return Math.floor(minutes / step) * step;
    case 'NEAREST':
      return Math.round(minutes / step) * step;
  }
}

/**
 * Turns billable minutes into money.
 *
 * How `rate_minor` is read depends on the mode, which is why the mode and the
 * rate always travel together:
 *   PER_MINUTE       rate per minute
 *   PER_HOUR         rate per hour, pro-rated
 *   FIXED_INCREMENT  rate per block of `increment_minutes`
 *   CUSTOM_SLABS     a flat price per band, from tenant settings
 */
function priceMinutes(
  minutes: number,
  settings: BillingSettings,
  rule: PricingRule | null,
): number {
  if (minutes <= 0) return 0;

  // A club on slab pricing has said "price time by band". That is a decision
  // about time, so it wins over the rule's own per-minute/hourly mode; rules
  // that replace time entirely (PER_FRAME, FLAT_SESSION) never reach here.
  if (settings.time_calculation_mode === 'CUSTOM_SLABS') {
    return priceFromSlabs(minutes, parseCustomSlabs(settings.custom_slabs));
  }

  const rate = Math.max(0, rule?.rate_minor ?? 0);
  const mode = rule?.pricing_mode ?? mapTimeModeToPricingMode(settings.time_calculation_mode);

  switch (mode) {
    case 'PER_MINUTE':
      return Math.round(minutes * rate);
    case 'PER_HOUR':
      return Math.round((minutes * rate) / 60);
    case 'FIXED_INCREMENT': {
      const block = Math.max(1, rule?.increment_minutes ?? settings.billing_increment_minutes);
      return Math.ceil(minutes / block) * rate;
    }
    // Handled before this function is reached, but the switch stays exhaustive.
    case 'PER_FRAME':
    case 'FLAT_SESSION':
      return 0;
  }
}

/** Prices the portion that ran past the booking. */
function priceOvertime(
  overtimeMinutes: number,
  settings: BillingSettings,
  rule: PricingRule | null,
): number {
  if (overtimeMinutes <= 0) return 0;

  switch (settings.overtime_mode) {
    case 'FREE':
      return 0;

    case 'SAME_RATE':
      return priceMinutes(overtimeMinutes, settings, rule);

    case 'OVERTIME_RATE': {
      // `overtime_rate_minor` is an hourly rate; a check constraint guarantees
      // it is present whenever this mode is selected.
      const hourly = Math.max(0, settings.overtime_rate_minor ?? 0);
      return Math.round((overtimeMinutes * hourly) / 60);
    }

    case 'INCREMENT_BLOCK': {
      // Charged in whole blocks. The rate is per block, falling back to the
      // pricing rule's own rate when no overtime rate is configured.
      const block = Math.max(1, settings.overtime_increment_minutes ?? 15);
      const perBlock = Math.max(0, settings.overtime_rate_minor ?? rule?.rate_minor ?? 0);
      return Math.ceil(overtimeMinutes / block) * perBlock;
    }
  }
}

function framePrice(settings: BillingSettings, rule: PricingRule | null): number {
  return Math.max(0, rule?.frame_price_minor ?? settings.default_frame_price_minor ?? 0);
}

/**
 * Frames charged *in addition* to table time.
 *
 * Only applies when the club has frame billing switched on. A club whose
 * pricing mode is PER_FRAME is handled separately - there, frames replace time
 * rather than supplementing it.
 */
function frameCharge(
  facts: SessionFacts,
  settings: BillingSettings,
  rule: PricingRule | null,
): number {
  if (!settings.frame_billing_enabled) return 0;
  const frames = Math.max(0, Math.floor(facts.framesPlayed));
  if (frames === 0) return 0;
  return frames * framePrice(settings, rule);
}

function frameOnlyCharge(
  facts: SessionFacts,
  settings: BillingSettings,
  rule: PricingRule,
  actualSeconds: number,
  notes: string[],
): ChargeResult {
  const frames = Math.max(0, Math.floor(facts.framesPlayed));
  const perFrame = framePrice(settings, rule);
  const amount = frames * perFrame;

  notes.push('Charged per frame; elapsed time is recorded but not billed.');

  return {
    actualSeconds,
    billableSeconds: actualSeconds,
    regularMinutes: secondsToMinutes(actualSeconds),
    overtimeMinutes: 0,
    graceMinutes: 0,
    regularChargeMinor: 0,
    overtimeChargeMinor: 0,
    frameChargeMinor: amount,
    tableChargeMinor: amount,
    lines: [
      { label: 'Frames', detail: `${frames} × ${perFrame} minor units`, amountMinor: amount },
    ],
    notes,
  };
}

/**
 * When no pricing rule matched, fall back to the club's time-calculation mode.
 * The charge will be zero without a rate, but the shape stays consistent and
 * the UI can say "no pricing configured" instead of crashing.
 */
function mapTimeModeToPricingMode(
  mode: BillingSettings['time_calculation_mode'],
): PricingRule['pricing_mode'] {
  switch (mode) {
    case 'PER_MINUTE':
      return 'PER_MINUTE';
    case 'PER_HOUR':
      return 'PER_HOUR';
    case 'FIXED_INCREMENT':
    case 'CUSTOM_SLABS':
      return 'FIXED_INCREMENT';
  }
}

// ===========================================================================
// Custom slabs
// ===========================================================================

/**
 * Reads `tenant_billing_settings.custom_slabs`, which is jsonb and therefore
 * `unknown` as far as the client is concerned. Anything malformed is dropped
 * rather than trusted.
 */
export function parseCustomSlabs(value: unknown): CustomSlab[] {
  if (!Array.isArray(value)) return [];

  const slabs: CustomSlab[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const upTo = record.up_to_minutes;
    const price = record.price_minor;
    if (typeof price !== 'number' || !Number.isFinite(price)) continue;
    if (upTo !== null && (typeof upTo !== 'number' || !Number.isFinite(upTo))) continue;
    slabs.push({ up_to_minutes: upTo as number | null, price_minor: price });
  }

  // Open-ended band last, otherwise ascending.
  return slabs.sort((a, b) => {
    if (a.up_to_minutes === null) return 1;
    if (b.up_to_minutes === null) return -1;
    return a.up_to_minutes - b.up_to_minutes;
  });
}

/** Flat price for the band the duration falls into. */
export function priceFromSlabs(minutes: number, slabs: readonly CustomSlab[]): number {
  for (const slab of slabs) {
    if (slab.up_to_minutes === null || minutes <= slab.up_to_minutes) {
      return Math.max(0, slab.price_minor);
    }
  }
  return 0;
}

// ===========================================================================
// Descriptions, for the breakdown shown to staff
// ===========================================================================

function describeMode(settings: BillingSettings, rule: PricingRule | null): string {
  if (settings.time_calculation_mode === 'CUSTOM_SLABS') return 'slab pricing';
  const mode = rule?.pricing_mode ?? mapTimeModeToPricingMode(settings.time_calculation_mode);
  switch (mode) {
    case 'PER_MINUTE':
      return 'per minute';
    case 'PER_HOUR':
      return 'hourly';
    case 'FIXED_INCREMENT':
      return `${rule?.increment_minutes ?? settings.billing_increment_minutes} min blocks`;
    case 'PER_FRAME':
      return 'per frame';
    case 'FLAT_SESSION':
      return 'flat rate';
  }
}

function describeRounding(settings: BillingSettings): string {
  const step = settings.rounding_increment_minutes;
  switch (settings.rounding_mode) {
    case 'EXACT':
      return 'no rounding';
    case 'ROUND_UP':
      return `rounded up to ${step} min`;
    case 'ROUND_DOWN':
      return `rounded down to ${step} min`;
    case 'NEAREST':
      return `rounded to nearest ${step} min`;
  }
}

function describeOvertime(settings: BillingSettings): string {
  switch (settings.overtime_mode) {
    case 'SAME_RATE':
      return 'at the normal rate';
    case 'OVERTIME_RATE':
      return 'at the overtime rate';
    case 'INCREMENT_BLOCK':
      return `in ${settings.overtime_increment_minutes ?? 15} min blocks`;
    case 'FREE':
      return 'not charged';
  }
}
