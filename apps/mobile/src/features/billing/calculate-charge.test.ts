import { calculateSessionCharge, parseCustomSlabs, priceFromSlabs } from './calculate-charge';
import type { BillingSettings, PricingRule, SessionFacts } from './types';

/**
 * These tests are the specification for the billing engine.
 *
 * A mistake in this file does not crash anything - it silently overcharges or
 * undercharges real customers for months. So every rule gets a case with a
 * hand-computed expectation, and the two seeded clubs (configured differently
 * on purpose) are exercised as end-to-end fixtures.
 *
 * Money is in integer minor units throughout: 15000 = Rs 150.00.
 */

const BASE_SETTINGS: BillingSettings = {
  tenant_id: 'tenant-1',
  time_calculation_mode: 'PER_HOUR',
  billing_increment_minutes: 30,
  minimum_billable_minutes: 0,
  custom_slabs: [],
  rounding_mode: 'EXACT',
  rounding_increment_minutes: 1,
  grace_period_minutes: 0,
  overtime_mode: 'SAME_RATE',
  overtime_rate_minor: null,
  overtime_increment_minutes: null,
  frame_billing_enabled: false,
  default_frame_price_minor: null,
  notify_on_time_completed: true,
  notify_on_payment: true,
  low_stock_alerts_enabled: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const BASE_RULE: PricingRule = {
  id: 'rule-1',
  tenant_id: 'tenant-1',
  table_type_id: 'type-1',
  club_table_id: null,
  name: 'Test rule',
  pricing_mode: 'PER_HOUR',
  rate_minor: 36000, // Rs 360 / hour
  increment_minutes: null,
  minimum_minutes: 0,
  frame_price_minor: null,
  is_default: true,
  is_active: true,
  valid_from: '2026-01-01T00:00:00Z',
  valid_to: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const settings = (overrides: Partial<BillingSettings> = {}): BillingSettings => ({
  ...BASE_SETTINGS,
  ...overrides,
});
const rule = (overrides: Partial<PricingRule> = {}): PricingRule => ({
  ...BASE_RULE,
  ...overrides,
});

const START = '2026-08-20T10:00:00.000Z';
/** A session that ran for exactly `minutes`, against an optional booking. */
const played = (
  minutes: number,
  plannedDurationMinutes: number | null = null,
  frames = 0,
): SessionFacts => ({
  startedAt: START,
  endedAt: new Date(Date.parse(START) + minutes * 60_000).toISOString(),
  plannedDurationMinutes,
  framesPlayed: frames,
});

// ===========================================================================
// The rule the whole product is built around
// ===========================================================================

describe('recorded time vs billed time', () => {
  it('never lets a billing rule shorten what was actually played', () => {
    // 67 minutes played against a 60 minute booking, 5 minutes of grace.
    const result = calculateSessionCharge(
      played(67, 60),
      settings({ grace_period_minutes: 5 }),
      rule(),
    );

    expect(result.actualSeconds).toBe(67 * 60);
    expect(result.overtimeMinutes).toBe(7);
  });

  it('bills the booked time when the overrun is inside the grace period', () => {
    // 63 minutes played, 60 booked, 5 minutes grace: the 3 minutes are forgiven.
    const result = calculateSessionCharge(
      played(63, 60),
      settings({ grace_period_minutes: 5 }),
      rule(),
    );

    expect(result.actualSeconds).toBe(63 * 60); // the truth is untouched
    expect(result.billableSeconds).toBe(60 * 60); // what is charged differs
    expect(result.actualSeconds).not.toBe(result.billableSeconds);
    expect(result.graceMinutes).toBe(3);
    expect(result.overtimeMinutes).toBe(0);
    expect(result.tableChargeMinor).toBe(36000);
  });

  it('is a pure function of its inputs', () => {
    const a = calculateSessionCharge(played(42), settings(), rule(), 0);
    const b = calculateSessionCharge(played(42), settings(), rule(), 0);
    expect(a).toEqual(b);
  });
});

// ===========================================================================
// Grace period
// ===========================================================================

describe('grace period', () => {
  const withGrace = settings({ grace_period_minutes: 5 });

  it('charges nothing extra exactly at the edge of the grace', () => {
    const result = calculateSessionCharge(played(65, 60), withGrace, rule());
    expect(result.overtimeMinutes).toBe(0);
    expect(result.graceMinutes).toBe(5);
    expect(result.tableChargeMinor).toBe(36000);
  });

  it('measures overtime from the end of the booking once the grace is exceeded', () => {
    // 66 minutes: one minute past the grace, so all 6 overrun minutes are
    // overtime - the grace is a courtesy, not a free extension of the meter.
    const result = calculateSessionCharge(played(66, 60), withGrace, rule());
    expect(result.overtimeMinutes).toBe(6);
    expect(result.graceMinutes).toBe(0);
  });

  it('does nothing when the session has no booked duration', () => {
    const result = calculateSessionCharge(played(90, null), withGrace, rule());
    expect(result.overtimeMinutes).toBe(0);
    expect(result.regularMinutes).toBe(90);
  });

  it('does nothing when the booking was not reached', () => {
    const result = calculateSessionCharge(played(45, 60), withGrace, rule());
    expect(result.regularMinutes).toBe(45);
    expect(result.overtimeMinutes).toBe(0);
    expect(result.graceMinutes).toBe(0);
  });
});

// ===========================================================================
// Time calculation modes
// ===========================================================================

describe('time calculation modes', () => {
  it('PER_MINUTE charges the rate for every minute', () => {
    const result = calculateSessionCharge(
      played(42),
      settings({ time_calculation_mode: 'PER_MINUTE' }),
      rule({ pricing_mode: 'PER_MINUTE', rate_minor: 600 }),
    );
    expect(result.tableChargeMinor).toBe(42 * 600);
  });

  it('PER_HOUR pro-rates the hourly rate', () => {
    const result = calculateSessionCharge(played(90), settings(), rule({ rate_minor: 36000 }));
    expect(result.tableChargeMinor).toBe(54000); // 1.5h x Rs 360
  });

  it('FIXED_INCREMENT charges whole blocks, rounding a part-block up', () => {
    const fixed = rule({
      pricing_mode: 'FIXED_INCREMENT',
      rate_minor: 15000,
      increment_minutes: 30,
    });
    const s = settings({ time_calculation_mode: 'FIXED_INCREMENT' });

    expect(calculateSessionCharge(played(1), s, fixed).tableChargeMinor).toBe(15000);
    expect(calculateSessionCharge(played(30), s, fixed).tableChargeMinor).toBe(15000);
    expect(calculateSessionCharge(played(31), s, fixed).tableChargeMinor).toBe(30000);
    expect(calculateSessionCharge(played(90), s, fixed).tableChargeMinor).toBe(45000);
  });

  it('CUSTOM_SLABS charges a flat price for the band', () => {
    const s = settings({
      time_calculation_mode: 'CUSTOM_SLABS',
      custom_slabs: [
        { up_to_minutes: 60, price_minor: 15000 },
        { up_to_minutes: 120, price_minor: 25000 },
        { up_to_minutes: null, price_minor: 40000 },
      ],
    });

    expect(calculateSessionCharge(played(30), s, rule()).tableChargeMinor).toBe(15000);
    expect(calculateSessionCharge(played(60), s, rule()).tableChargeMinor).toBe(15000);
    expect(calculateSessionCharge(played(61), s, rule()).tableChargeMinor).toBe(25000);
    expect(calculateSessionCharge(played(200), s, rule()).tableChargeMinor).toBe(40000);
  });

  it('counts a started minute as a used minute', () => {
    const result = calculateSessionCharge(
      {
        startedAt: START,
        endedAt: '2026-08-20T10:01:30.000Z',
        plannedDurationMinutes: null,
        framesPlayed: 0,
      },
      settings({ time_calculation_mode: 'PER_MINUTE' }),
      rule({ pricing_mode: 'PER_MINUTE', rate_minor: 100 }),
    );
    expect(result.regularMinutes).toBe(2);
    expect(result.tableChargeMinor).toBe(200);
  });
});

// ===========================================================================
// Rounding
// ===========================================================================

describe('rounding', () => {
  const perMinute = rule({ pricing_mode: 'PER_MINUTE', rate_minor: 100 });
  const forMode = (rounding_mode: BillingSettings['rounding_mode'], increment = 15) =>
    settings({
      time_calculation_mode: 'PER_MINUTE',
      rounding_mode,
      rounding_increment_minutes: increment,
    });

  it('EXACT leaves the minutes alone', () => {
    expect(calculateSessionCharge(played(42), forMode('EXACT'), perMinute).regularMinutes).toBe(42);
  });

  it('ROUND_UP goes to the next increment', () => {
    expect(calculateSessionCharge(played(42), forMode('ROUND_UP'), perMinute).regularMinutes).toBe(
      45,
    );
    expect(calculateSessionCharge(played(45), forMode('ROUND_UP'), perMinute).regularMinutes).toBe(
      45,
    );
  });

  it('ROUND_DOWN goes to the previous increment', () => {
    expect(
      calculateSessionCharge(played(44), forMode('ROUND_DOWN'), perMinute).regularMinutes,
    ).toBe(30);
  });

  it('NEAREST goes either way', () => {
    expect(
      calculateSessionCharge(played(38), forMode('NEAREST', 5), perMinute).regularMinutes,
    ).toBe(40);
    expect(
      calculateSessionCharge(played(42), forMode('NEAREST', 5), perMinute).regularMinutes,
    ).toBe(40);
  });

  it('explains the adjustment', () => {
    const result = calculateSessionCharge(played(42), forMode('ROUND_UP'), perMinute);
    expect(result.notes.join(' ')).toMatch(/Rounded 42 min to 45 min/);
  });
});

// ===========================================================================
// Minimum billable time
// ===========================================================================

describe('minimum billable time', () => {
  it('lifts a short session to the minimum', () => {
    const result = calculateSessionCharge(
      played(5),
      settings({ minimum_billable_minutes: 30 }),
      rule(),
    );
    expect(result.regularMinutes).toBe(30);
    expect(result.tableChargeMinor).toBe(18000); // half an hour at Rs 360
    expect(result.notes.join(' ')).toMatch(/Minimum billable time of 30 minutes/);
  });

  it('takes the higher of the club setting and the pricing rule', () => {
    const result = calculateSessionCharge(
      played(5),
      settings({ minimum_billable_minutes: 15 }),
      rule({ minimum_minutes: 45 }),
    );
    expect(result.regularMinutes).toBe(45);
  });

  it('does not shorten a session that already exceeds it', () => {
    const result = calculateSessionCharge(
      played(90),
      settings({ minimum_billable_minutes: 30 }),
      rule(),
    );
    expect(result.regularMinutes).toBe(90);
  });
});

// ===========================================================================
// Overtime modes
// ===========================================================================

describe('overtime modes', () => {
  const over = played(80, 60); // 20 minutes past the booking

  it('SAME_RATE continues at the normal price', () => {
    const result = calculateSessionCharge(over, settings({ overtime_mode: 'SAME_RATE' }), rule());
    expect(result.overtimeMinutes).toBe(20);
    expect(result.overtimeChargeMinor).toBe(12000); // 20 min at Rs 360/h
    expect(result.tableChargeMinor).toBe(48000);
  });

  it('OVERTIME_RATE uses the separate hourly rate', () => {
    const result = calculateSessionCharge(
      over,
      settings({ overtime_mode: 'OVERTIME_RATE', overtime_rate_minor: 60000 }),
      rule(),
    );
    expect(result.overtimeChargeMinor).toBe(20000); // 20 min at Rs 600/h
  });

  it('INCREMENT_BLOCK charges whole blocks', () => {
    const result = calculateSessionCharge(
      played(65, 60),
      settings({
        overtime_mode: 'INCREMENT_BLOCK',
        overtime_increment_minutes: 15,
        overtime_rate_minor: 10000,
      }),
      rule(),
    );
    // 5 minutes over rounds up to one 15 minute block.
    expect(result.overtimeMinutes).toBe(5);
    expect(result.overtimeChargeMinor).toBe(10000);
  });

  it('FREE charges nothing for the overrun but still records it', () => {
    const result = calculateSessionCharge(over, settings({ overtime_mode: 'FREE' }), rule());
    expect(result.overtimeMinutes).toBe(20);
    expect(result.overtimeChargeMinor).toBe(0);
    expect(result.tableChargeMinor).toBe(36000);
    expect(result.notes.join(' ')).toMatch(/does not charge for overtime/);
  });
});

// ===========================================================================
// Frames
// ===========================================================================

describe('frame billing', () => {
  it('adds frames on top of table time when enabled', () => {
    const result = calculateSessionCharge(
      played(60, null, 3),
      settings({ frame_billing_enabled: true, default_frame_price_minor: 5000 }),
      rule(),
    );
    expect(result.frameChargeMinor).toBe(15000);
    expect(result.tableChargeMinor).toBe(36000 + 15000);
  });

  it('ignores frames when the club has frame billing off', () => {
    const result = calculateSessionCharge(played(60, null, 3), settings(), rule());
    expect(result.frameChargeMinor).toBe(0);
  });

  it('PER_FRAME replaces time entirely', () => {
    const result = calculateSessionCharge(
      played(95, null, 4),
      settings({ frame_billing_enabled: true }),
      rule({ pricing_mode: 'PER_FRAME', frame_price_minor: 5000 }),
    );
    expect(result.regularChargeMinor).toBe(0);
    expect(result.overtimeChargeMinor).toBe(0);
    expect(result.tableChargeMinor).toBe(20000);
    // Time is still recorded even though it is not billed.
    expect(result.actualSeconds).toBe(95 * 60);
    expect(result.notes.join(' ')).toMatch(/elapsed time is recorded but not billed/);
  });

  it('FLAT_SESSION ignores both time and frames', () => {
    const result = calculateSessionCharge(
      played(180, 60, 9),
      settings(),
      rule({ pricing_mode: 'FLAT_SESSION', rate_minor: 25000 }),
    );
    expect(result.tableChargeMinor).toBe(25000);
    expect(result.actualSeconds).toBe(180 * 60);
  });
});

// ===========================================================================
// The two seeded clubs, end to end
// ===========================================================================

describe('real club configurations', () => {
  // Royal Snooker: 30 min blocks, round up to 15, 5 min grace, frames enabled.
  const royalSettings = settings({
    time_calculation_mode: 'FIXED_INCREMENT',
    billing_increment_minutes: 30,
    minimum_billable_minutes: 30,
    rounding_mode: 'ROUND_UP',
    rounding_increment_minutes: 15,
    grace_period_minutes: 5,
    overtime_mode: 'SAME_RATE',
    frame_billing_enabled: true,
    default_frame_price_minor: 5000,
  });
  const royalRule = rule({
    name: 'Snooker · half-hourly',
    pricing_mode: 'FIXED_INCREMENT',
    rate_minor: 15000,
    increment_minutes: 30,
    minimum_minutes: 30,
    frame_price_minor: 5000,
  });

  // Blue Cue: per minute, nearest 5, no grace, separate overtime rate.
  const blueSettings = settings({
    time_calculation_mode: 'PER_MINUTE',
    billing_increment_minutes: 1,
    minimum_billable_minutes: 15,
    rounding_mode: 'NEAREST',
    rounding_increment_minutes: 5,
    grace_period_minutes: 0,
    overtime_mode: 'OVERTIME_RATE',
    overtime_rate_minor: 40000,
    frame_billing_enabled: false,
  });
  const blueRule = rule({
    name: 'Snooker · hourly',
    pricing_mode: 'PER_HOUR',
    rate_minor: 36000,
    minimum_minutes: 15,
  });

  it('Royal: 67 min against a 60 min booking', () => {
    const result = calculateSessionCharge(played(67, 60), royalSettings, royalRule);
    // 60 booked -> 2 blocks = Rs 300. 7 min overtime at the same rate -> 1
    // block = Rs 150.
    expect(result.regularChargeMinor).toBe(30000);
    expect(result.overtimeChargeMinor).toBe(15000);
    expect(result.tableChargeMinor).toBe(45000);
    expect(result.actualSeconds).toBe(4020);
  });

  it('Blue Cue: the same 67 minutes costs a different amount', () => {
    const result = calculateSessionCharge(played(67, 60), blueSettings, blueRule);
    // 60 min at Rs 360/h = Rs 360. 7 min at the Rs 400/h overtime rate.
    expect(result.regularChargeMinor).toBe(36000);
    expect(result.overtimeChargeMinor).toBe(4667);
    expect(result.tableChargeMinor).toBe(40667);
  });

  it('the two clubs disagree on price for identical play, which is the point', () => {
    const facts = played(67, 60);
    const royal = calculateSessionCharge(facts, royalSettings, royalRule);
    const blue = calculateSessionCharge(facts, blueSettings, blueRule);

    expect(royal.actualSeconds).toBe(blue.actualSeconds); // same reality
    expect(royal.tableChargeMinor).not.toBe(blue.tableChargeMinor); // different bills
  });

  it('Royal: a 20 minute session still pays the 30 minute minimum', () => {
    const result = calculateSessionCharge(played(20), royalSettings, royalRule);
    expect(result.regularMinutes).toBe(30);
    expect(result.tableChargeMinor).toBe(15000);
  });
});

// ===========================================================================
// Edge cases
// ===========================================================================

describe('edge cases', () => {
  it('prices a running session as of now', () => {
    const now = Date.parse(START) + 30 * 60_000;
    const result = calculateSessionCharge(
      { startedAt: START, endedAt: null, plannedDurationMinutes: 60, framesPlayed: 0 },
      settings(),
      rule(),
      now,
    );
    expect(result.actualSeconds).toBe(1800);
    expect(result.tableChargeMinor).toBe(18000);
  });

  it('handles a zero-length session', () => {
    const result = calculateSessionCharge(played(0), settings(), rule());
    expect(result.actualSeconds).toBe(0);
    expect(result.tableChargeMinor).toBe(0);
  });

  it('never returns a negative charge for a clock that went backwards', () => {
    const result = calculateSessionCharge(
      {
        startedAt: START,
        endedAt: '2026-08-20T09:00:00.000Z',
        plannedDurationMinutes: null,
        framesPlayed: 0,
      },
      settings(),
      rule(),
    );
    expect(result.actualSeconds).toBe(0);
    expect(result.tableChargeMinor).toBeGreaterThanOrEqual(0);
  });

  it('degrades to a zero charge rather than crashing with no pricing rule', () => {
    const result = calculateSessionCharge(played(60), settings(), null);
    expect(result.tableChargeMinor).toBe(0);
    expect(result.actualSeconds).toBe(3600); // the record is still correct
  });

  it('produces an auditable breakdown', () => {
    const result = calculateSessionCharge(
      played(80, 60, 2),
      settings({ frame_billing_enabled: true, default_frame_price_minor: 5000 }),
      rule(),
    );
    expect(result.lines.map((l) => l.label)).toEqual(['Table time', 'Overtime', 'Frames']);
    expect(result.lines.reduce((sum, l) => sum + l.amountMinor, 0)).toBe(result.tableChargeMinor);
  });

  it('always returns whole minor units, never fractions', () => {
    for (const minutes of [7, 13, 29, 41, 59, 83]) {
      const result = calculateSessionCharge(
        played(minutes),
        settings(),
        rule({ rate_minor: 33333 }),
      );
      expect(Number.isInteger(result.tableChargeMinor)).toBe(true);
    }
  });
});

// ===========================================================================
// Slab parsing - jsonb arrives as `unknown` and cannot be trusted
// ===========================================================================

describe('parseCustomSlabs', () => {
  it('sorts bands ascending with the open-ended one last', () => {
    const slabs = parseCustomSlabs([
      { up_to_minutes: null, price_minor: 40000 },
      { up_to_minutes: 120, price_minor: 25000 },
      { up_to_minutes: 60, price_minor: 15000 },
    ]);
    expect(slabs.map((s) => s.up_to_minutes)).toEqual([60, 120, null]);
  });

  it('drops malformed entries instead of trusting them', () => {
    const slabs = parseCustomSlabs([
      { up_to_minutes: 60, price_minor: 15000 },
      { up_to_minutes: 'sixty', price_minor: 1 },
      { up_to_minutes: 30 },
      null,
      'nonsense',
      42,
    ]);
    expect(slabs).toEqual([{ up_to_minutes: 60, price_minor: 15000 }]);
  });

  it('returns an empty list for anything that is not an array', () => {
    expect(parseCustomSlabs(null)).toEqual([]);
    expect(parseCustomSlabs({})).toEqual([]);
    expect(parseCustomSlabs(undefined)).toEqual([]);
  });

  it('charges zero when no band matches', () => {
    expect(priceFromSlabs(500, [{ up_to_minutes: 60, price_minor: 15000 }])).toBe(0);
  });
});
