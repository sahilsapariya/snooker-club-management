import { calculateSessionCharge } from '@/features/billing';
import type { BillingSettings } from '@/features/billing';

import { pricingRuleFromSnapshot } from './sessions.api';

/**
 * The snapshot is what stops a price change from rewriting a bill that is
 * already running. These tests pin that down, and pin down that a malformed or
 * missing snapshot degrades to "cannot price" rather than to a wrong price.
 */

const SETTINGS: BillingSettings = {
  tenant_id: 't',
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

const SNAPSHOT = {
  pricing_rule_id: 'rule-1',
  name: 'Snooker · hourly',
  pricing_mode: 'PER_HOUR',
  rate_minor: 36000,
  increment_minutes: null,
  minimum_minutes: 15,
  frame_price_minor: null,
  captured_at: '2026-08-20T10:00:00.000Z',
};

describe('pricingRuleFromSnapshot', () => {
  it('reconstructs the rule captured when the session started', () => {
    const rule = pricingRuleFromSnapshot(SNAPSHOT);

    expect(rule).not.toBeNull();
    expect(rule?.pricing_mode).toBe('PER_HOUR');
    expect(rule?.rate_minor).toBe(36000);
    expect(rule?.minimum_minutes).toBe(15);
    expect(rule?.name).toBe('Snooker · hourly');
  });

  /**
   * The scenario this exists to prevent: a club raises its hourly rate at 8pm
   * while a session started at 7pm is still running. The running session must
   * keep the old price.
   */
  it('prices a running session at the old rate after a mid-session price rise', () => {
    const facts = {
      startedAt: '2026-08-20T10:00:00.000Z',
      endedAt: '2026-08-20T11:00:00.000Z',
      plannedDurationMinutes: null,
      framesPlayed: 0,
    };

    const atStart = pricingRuleFromSnapshot(SNAPSHOT);
    // The catalogue has since moved to Rs 500/hour.
    const raised = { ...SNAPSHOT, rate_minor: 50000 };
    const afterRise = pricingRuleFromSnapshot(raised);

    expect(calculateSessionCharge(facts, SETTINGS, atStart).tableChargeMinor).toBe(36000);
    // Proof the engine would have charged more had it read the live rule.
    expect(calculateSessionCharge(facts, SETTINGS, afterRise).tableChargeMinor).toBe(50000);
  });

  it('returns null for a session started with no pricing configured', () => {
    expect(pricingRuleFromSnapshot({})).toBeNull();
    expect(pricingRuleFromSnapshot(null)).toBeNull();
    expect(pricingRuleFromSnapshot(undefined)).toBeNull();
  });

  it('returns null rather than guessing when the snapshot is malformed', () => {
    expect(pricingRuleFromSnapshot({ rate_minor: 'lots' })).toBeNull();
    expect(pricingRuleFromSnapshot({ rate_minor: 100 })).toBeNull(); // no mode
    expect(pricingRuleFromSnapshot({ pricing_mode: 'PER_HOUR' })).toBeNull(); // no rate
    expect(pricingRuleFromSnapshot('nonsense')).toBeNull();
  });

  it('degrades to a zero charge, never a wrong one, when the snapshot is unusable', () => {
    const result = calculateSessionCharge(
      {
        startedAt: '2026-08-20T10:00:00.000Z',
        endedAt: '2026-08-20T11:00:00.000Z',
        plannedDurationMinutes: null,
        framesPlayed: 0,
      },
      SETTINGS,
      pricingRuleFromSnapshot({ broken: true }),
    );

    expect(result.tableChargeMinor).toBe(0);
    // The recorded facts survive regardless.
    expect(result.actualSeconds).toBe(3600);
  });

  it('tolerates a snapshot missing its optional fields', () => {
    const rule = pricingRuleFromSnapshot({ pricing_mode: 'PER_MINUTE', rate_minor: 500 });
    expect(rule?.minimum_minutes).toBe(0);
    expect(rule?.increment_minutes).toBeNull();
    expect(rule?.name).toBe('Rate at start of session');
  });
});
