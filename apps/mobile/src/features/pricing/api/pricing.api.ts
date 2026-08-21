import { unwrap } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import type { Database } from '@/types/database.types';

export type PricingRule = Database['public']['Tables']['pricing_rules']['Row'];
export type BillingSettings = Database['public']['Tables']['tenant_billing_settings']['Row'];
export type PricingMode = Database['public']['Enums']['pricing_mode'];

export interface PricingRuleWithType extends PricingRule {
  readonly table_type: { id: string; name: string; code: string } | null;
}

/**
 * Owner-only pricing configuration.
 *
 * Changing a rule here never affects a session already running: sessions
 * snapshot the rule they started under. That is why editing prices mid-evening
 * is a safe operation rather than something that has to wait for closing time.
 */

export async function fetchPricingRules(tenantId: string): Promise<PricingRuleWithType[]> {
  const result = await supabase
    .from('pricing_rules')
    .select('*, table_type:table_types(id, name, code)')
    .eq('tenant_id', tenantId)
    .order('is_active', { ascending: false })
    .order('name', { ascending: true });

  return (unwrap(result, 'load pricing rules') ?? []) as PricingRuleWithType[];
}

export interface UpsertPricingRuleInput {
  readonly tenantId: string;
  readonly id?: string;
  readonly tableTypeId: string | null;
  readonly name: string;
  readonly pricingMode: PricingMode;
  readonly rateMinor: number;
  readonly incrementMinutes: number | null;
  readonly minimumMinutes: number;
  readonly framePriceMinor: number | null;
  readonly isDefault: boolean;
}

/**
 * The check constraints on `pricing_rules` are mode-specific:
 * FIXED_INCREMENT needs an increment, PER_FRAME needs a frame price. Sending
 * the wrong shape is rejected by the database rather than silently accepted, so
 * the form must ask for the right fields per mode.
 */
export async function createPricingRule(input: UpsertPricingRuleInput): Promise<PricingRule> {
  const result = await supabase
    .from('pricing_rules')
    .insert({
      tenant_id: input.tenantId,
      table_type_id: input.tableTypeId,
      name: input.name,
      pricing_mode: input.pricingMode,
      rate_minor: input.rateMinor,
      increment_minutes: input.incrementMinutes,
      minimum_minutes: input.minimumMinutes,
      frame_price_minor: input.framePriceMinor,
      is_default: input.isDefault,
    })
    .select('*')
    .single();

  return unwrap(result, 'create pricing rule');
}

export async function updatePricingRule(
  input: UpsertPricingRuleInput & { id: string },
): Promise<PricingRule> {
  const result = await supabase
    .from('pricing_rules')
    .update({
      table_type_id: input.tableTypeId,
      name: input.name,
      pricing_mode: input.pricingMode,
      rate_minor: input.rateMinor,
      increment_minutes: input.incrementMinutes,
      minimum_minutes: input.minimumMinutes,
      frame_price_minor: input.framePriceMinor,
      is_default: input.isDefault,
    })
    .eq('id', input.id)
    .select('*')
    .single();

  return unwrap(result, 'update pricing rule');
}

export async function setPricingRuleActive(
  ruleId: string,
  isActive: boolean,
): Promise<PricingRule> {
  const result = await supabase
    .from('pricing_rules')
    .update({ is_active: isActive })
    .eq('id', ruleId)
    .select('*')
    .single();

  return unwrap(result, 'update pricing rule');
}

/** Billing rules are per club and owner-editable; branding is not. */
export async function updateBillingSettings(
  tenantId: string,
  patch: Partial<
    Pick<
      BillingSettings,
      | 'time_calculation_mode'
      | 'billing_increment_minutes'
      | 'minimum_billable_minutes'
      | 'rounding_mode'
      | 'rounding_increment_minutes'
      | 'grace_period_minutes'
      | 'overtime_mode'
      | 'overtime_rate_minor'
      | 'overtime_increment_minutes'
      | 'frame_billing_enabled'
      | 'default_frame_price_minor'
      | 'notify_on_time_completed'
      | 'notify_on_payment'
      | 'low_stock_alerts_enabled'
    >
  >,
): Promise<BillingSettings> {
  const result = await supabase
    .from('tenant_billing_settings')
    .update(patch)
    .eq('tenant_id', tenantId)
    .select('*')
    .single();

  return unwrap(result, 'update billing settings');
}
