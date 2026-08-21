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
 * One club this user may operate, and the role they hold in it.
 *
 * An owner can hold several of these on a single login; a receptionist holds
 * exactly one (enforced by a partial unique index, see migration 0015).
 */
export interface AccessibleClub {
  readonly tenant: Tenant;
  readonly membership: TenantMembership;
  readonly role: TenantRole;
}

/** A club is operable when its subscription is live. */
export function isOperable(club: AccessibleClub): boolean {
  return club.tenant.status === 'ACTIVE' || club.tenant.status === 'TRIAL';
}

/**
 * What the membership read returns, before the active club is applied.
 *
 * Deliberately separate from `AppSessionState`: this is server state keyed by
 * user, while the active club is client state. Switching club must not refetch
 * the membership set.
 */
export interface SessionIdentity {
  readonly profile: Profile;
  readonly platformAdmin: PlatformAdmin | null;
  readonly clubs: readonly AccessibleClub[];
}

/**
 * Every state the app can be in after authentication, as one closed union.
 *
 * Modelling it this way is what keeps route guards honest: a screen cannot
 * "forget" that an account might be disabled, that a user might have no club,
 * or that a multi-club owner might not have picked one yet, because the
 * compiler will not let it read `tenant` outside the variants that have one.
 *
 * None of this is a security boundary. Row Level Security decides what the user
 * can actually touch; this union only decides what we render.
 */
export type AppSessionState =
  /** Restoring a stored session, or resolving identity and club. */
  | { readonly status: 'loading' }
  /** No session, or the session was rejected. Show the login screen. */
  | { readonly status: 'unauthenticated'; readonly reason?: 'signed-out' | 'session-expired' }
  /** Signed in, but resolving who they are failed. Recoverable; offer a retry. */
  | { readonly status: 'error'; readonly error: AppError }
  /** Signed in, but the profile has been deactivated. */
  | { readonly status: 'account-disabled'; readonly profile: Profile }
  /** Signed in with a valid profile that belongs to no club. */
  | { readonly status: 'no-tenant'; readonly profile: Profile }
  /**
   * Reaches more than one club and has not chosen. Only owners land here -
   * a receptionist has one club, which is selected automatically.
   */
  | {
      readonly status: 'club-selection';
      readonly profile: Profile;
      readonly clubs: readonly AccessibleClub[];
    }
  /** Every club they belong to is suspended or archived by the platform. */
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
  /** The normal case: operating one specific club. */
  | {
      readonly status: 'tenant-user';
      readonly profile: Profile;
      readonly tenant: Tenant;
      readonly membership: TenantMembership;
      readonly role: TenantRole;
      readonly billingSettings: BillingSettings | null;
      /** Every club this login can reach, for the switcher. */
      readonly clubs: readonly AccessibleClub[];
      /** True when there is somewhere else to switch to. */
      readonly canSwitchClubs: boolean;
    };

export type AppSessionStatus = AppSessionState['status'];

export function isSignedIn(state: AppSessionState): boolean {
  return state.status !== 'loading' && state.status !== 'unauthenticated';
}

/** True only for a fully resolved club user with an active club. */
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

/** The active club's id, or null when no club is selected. */
export function activeTenantId(state: AppSessionState): string | null {
  return isTenantUser(state) ? state.tenant.id : null;
}
