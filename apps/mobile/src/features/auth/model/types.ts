import type { AppError } from '@/lib/errors';
import type { Database } from '@/types/database.types';

export type Tables = Database['public']['Tables'];

export type Profile = Tables['profiles']['Row'];
export type Tenant = Tables['tenants']['Row'];
export type TenantMembership = Tables['tenant_memberships']['Row'];
export type BillingSettings = Tables['tenant_billing_settings']['Row'];
export type PlatformAdmin = Tables['platform_admins']['Row'];

export type TenantRole = Database['public']['Enums']['tenant_role'];
export type PlatformRole = Database['public']['Enums']['platform_role'];

/**
 * Every state the app can be in after authentication, as one closed union.
 *
 * Modelling it this way is what keeps route guards honest: a screen cannot
 * "forget" that an account might be disabled or that a user might have no club,
 * because the compiler will not let it read `tenant` outside the one variant
 * that has it.
 *
 * None of this is a security boundary. Row Level Security decides what the user
 * can actually touch; this union only decides what we render.
 */
export type AppSessionState =
  /** Restoring a stored session, or resolving role and tenant. */
  | { readonly status: 'loading' }
  /** No session, or the session was rejected. Show the login screen. */
  | { readonly status: 'unauthenticated'; readonly reason?: 'signed-out' | 'session-expired' }
  /** Signed in, but resolving who they are failed. Recoverable; offer a retry. */
  | { readonly status: 'error'; readonly error: AppError }
  /** Signed in, but the profile has been deactivated. */
  | { readonly status: 'account-disabled'; readonly profile: Profile }
  /** Signed in with a valid profile that belongs to no club. */
  | { readonly status: 'no-tenant'; readonly profile: Profile }
  /** The club exists but is suspended or archived by the platform. */
  | {
      readonly status: 'tenant-suspended';
      readonly profile: Profile;
      readonly tenant: Tenant;
    }
  /** Product owner / support. Not a club user. */
  | {
      readonly status: 'platform-admin';
      readonly profile: Profile;
      readonly platformRole: PlatformRole;
    }
  /** The normal case: a member of staff at one club. */
  | {
      readonly status: 'tenant-user';
      readonly profile: Profile;
      readonly tenant: Tenant;
      readonly membership: TenantMembership;
      readonly role: TenantRole;
      readonly billingSettings: BillingSettings | null;
    };

export type AppSessionStatus = AppSessionState['status'];

export function isSignedIn(state: AppSessionState): boolean {
  return state.status !== 'loading' && state.status !== 'unauthenticated';
}

/** True only for a fully resolved club user. */
export function isTenantUser(
  state: AppSessionState,
): state is Extract<AppSessionState, { status: 'tenant-user' }> {
  return state.status === 'tenant-user';
}

export function isPlatformAdmin(
  state: AppSessionState,
): state is Extract<AppSessionState, { status: 'platform-admin' }> {
  return state.status === 'platform-admin';
}

/**
 * Convenience predicate for UI affordances only.
 *
 * Hiding a button is presentation. The database refuses the write regardless,
 * which is the actual guarantee.
 */
export function canManageClub(state: AppSessionState): boolean {
  return isTenantUser(state) && state.role === 'OWNER';
}
