import { unwrap } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import type { Database } from '@/types/database.types';

import type { BillingSettings } from '../types';

type Enums = Database['public']['Enums'];

/**
 * The club's billing rules.
 *
 * Owner-only to write, and enforced in Postgres: migration 0015 narrowed the
 * insert and update policies on `tenant_billing_settings` from
 * `can_manage_tenant` to `is_tenant_owner`, which means a *platform*
 * administrator cannot change them either. How a club charges its customers is
 * the club's commercial decision, not the platform's.
 *
 * There is deliberately no delete: every club has exactly one settings row,
 * created by the provisioning trigger. Removing it would leave sessions with
 * nothing to price them by.
 */

export interface UpdateBillingSettingsInput {
  readonly tenantId: string;
  readonly timeCalculationMode?: Enums['time_calculation_mode'];
  readonly billingIncrementMinutes?: number;
  readonly minimumBillableMinutes?: number;
  readonly roundingMode?: Enums['rounding_mode'];
  readonly roundingIncrementMinutes?: number;
  readonly gracePeriodMinutes?: number;
  readonly overtimeMode?: Enums['overtime_mode'];
  readonly overtimeRateMinor?: number | null;
  readonly overtimeIncrementMinutes?: number | null;
  readonly frameBillingEnabled?: boolean;
  readonly defaultFramePriceMinor?: number | null;
  readonly notifyOnTimeCompleted?: boolean;
  readonly notifyOnPayment?: boolean;
  readonly lowStockAlertsEnabled?: boolean;
}

export async function updateBillingSettings(
  input: UpdateBillingSettingsInput,
): Promise<BillingSettings> {
  const result = await supabase
    .from('tenant_billing_settings')
    .update({
      ...opt('time_calculation_mode', input.timeCalculationMode),
      ...opt('billing_increment_minutes', input.billingIncrementMinutes),
      ...opt('minimum_billable_minutes', input.minimumBillableMinutes),
      ...opt('rounding_mode', input.roundingMode),
      ...opt('rounding_increment_minutes', input.roundingIncrementMinutes),
      ...opt('grace_period_minutes', input.gracePeriodMinutes),
      ...opt('overtime_mode', input.overtimeMode),
      ...opt('overtime_rate_minor', input.overtimeRateMinor),
      ...opt('overtime_increment_minutes', input.overtimeIncrementMinutes),
      ...opt('frame_billing_enabled', input.frameBillingEnabled),
      ...opt('default_frame_price_minor', input.defaultFramePriceMinor),
      ...opt('notify_on_time_completed', input.notifyOnTimeCompleted),
      ...opt('notify_on_payment', input.notifyOnPayment),
      ...opt('low_stock_alerts_enabled', input.lowStockAlertsEnabled),
    })
    .eq('tenant_id', input.tenantId)
    .select('*')
    .single();

  return unwrap(result, 'save billing rules');
}

// `undefined` means "not being changed"; `null` is a real value here (clearing
// an overtime rate), so it must survive.
function opt<K extends string, V>(key: K, value: V | undefined) {
  return value === undefined ? {} : ({ [key]: value } as Record<K, V>);
}
