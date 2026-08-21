import { unwrap } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import type { Database } from '@/types/database.types';

export type StaffMember = Database['public']['Functions']['tenant_staff']['Returns'][number];
export type TenantRole = Database['public']['Enums']['tenant_role'];
export type MembershipStatus = Database['public']['Enums']['membership_status'];

/**
 * Club staff.
 *
 * The roster is deliberately per-club, not per-owner: an owner running three
 * clubs has three separate teams, and the app must never present them as one.
 *
 * All three calls go through RPCs rather than table access:
 *
 *   tenant_staff           SECURITY INVOKER - composes two reads the caller
 *                          could already make, in one shape
 *   add_tenant_member      SECURITY DEFINER - looks the account up by email,
 *                          and refuses OWNER unless the platform is asking
 *   set_membership_status  SECURITY DEFINER - enforces two rules RLS cannot
 *                          express: a club keeps an owner, and nobody revokes
 *                          their own access
 */

export async function fetchStaff(tenantId: string): Promise<StaffMember[]> {
  const result = await supabase.rpc('tenant_staff', { p_tenant_id: tenantId });
  return unwrap(result, 'load club staff') ?? [];
}

/**
 * Adds someone who already has an account.
 *
 * There is no "invite by email" here, and that is a deliberate limitation
 * rather than an oversight: creating an auth account requires privileges the
 * mobile app does not have and must never have. The account is created in
 * Supabase Auth first; this links it to the club.
 */
export async function addStaffMember(params: {
  readonly tenantId: string;
  readonly email: string;
  readonly role: TenantRole;
}) {
  const result = await supabase.rpc('add_tenant_member', {
    p_tenant_id: params.tenantId,
    p_email: params.email.trim(),
    p_role: params.role,
  });

  return unwrap(result, 'add staff member');
}

/**
 * Revokes or restores access.
 *
 * Never a delete. A former receptionist's name still appears against every
 * session they opened and every payment they took; removing the row would
 * orphan that history. A DISABLED membership stops appearing in
 * `app.tenant_ids()`, which is what actually ends their access.
 */
export async function setStaffStatus(params: {
  readonly membershipId: string;
  readonly status: MembershipStatus;
}) {
  const result = await supabase.rpc('set_membership_status', {
    p_membership_id: params.membershipId,
    p_status: params.status,
  });

  return unwrap(result, 'update staff access');
}
