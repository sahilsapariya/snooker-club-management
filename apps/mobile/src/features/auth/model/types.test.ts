import { AppError } from '@/lib/errors';

import {
  activeTenantId,
  canManageClub,
  isOperable,
  isPlatformAdmin,
  isSignedIn,
  isTenantUser,
  type AccessibleClub,
  type AppSessionState,
  type BillingSettings,
  type Profile,
  type Tenant,
  type TenantMembership,
  type TenantRole,
} from './types';

/**
 * These predicates decide which shell a user sees. They are not the security
 * boundary - Row Level Security is - but a mistake here would show a
 * receptionist an owner's screen, so they are worth pinning down.
 */

const profile = { id: 'user-1', email: 'reception@royalsnooker.dev' } as Profile;
const tenant = { id: 'tenant-1', name: 'Royal Snooker Club', status: 'ACTIVE' } as Tenant;
const membership = { id: 'm-1', tenant_id: 'tenant-1', user_id: 'user-1' } as TenantMembership;

const club = (id: string, name: string, status: Tenant['status'] = 'ACTIVE'): AccessibleClub => ({
  tenant: { id, name, status } as Tenant,
  membership: { id: `m-${id}`, tenant_id: id, user_id: 'user-1' } as TenantMembership,
  role: 'OWNER',
});

const tenantUser = (role: TenantRole, clubs: AccessibleClub[] = []): AppSessionState => ({
  status: 'tenant-user',
  profile,
  tenant,
  membership,
  role,
  billingSettings: null as BillingSettings | null,
  clubs,
  canSwitchClubs: clubs.length > 1,
});

const states: Record<string, AppSessionState> = {
  loading: { status: 'loading' },
  unauthenticated: { status: 'unauthenticated' },
  expired: { status: 'unauthenticated', reason: 'session-expired' },
  error: { status: 'error', error: new AppError({ code: 'unknown', message: 'boom' }) },
  disabled: { status: 'account-disabled', profile },
  noTenant: { status: 'no-tenant', profile },
  suspended: { status: 'tenant-suspended', profile, tenant },
  platform: { status: 'platform-admin', profile, platformRole: 'SUPER_ADMIN' },
  selection: {
    status: 'club-selection',
    profile,
    clubs: [club('tenant-1', 'Royal'), club('tenant-2', 'Blue Cue')],
  },
  owner: tenantUser('OWNER'),
  receptionist: tenantUser('RECEPTIONIST'),
};

describe('session state predicates', () => {
  it('treats only loading and unauthenticated as not signed in', () => {
    expect(isSignedIn(states.loading as AppSessionState)).toBe(false);
    expect(isSignedIn(states.unauthenticated as AppSessionState)).toBe(false);
    expect(isSignedIn(states.expired as AppSessionState)).toBe(false);

    for (const key of [
      'error',
      'disabled',
      'noTenant',
      'suspended',
      'platform',
      'selection',
      'owner',
    ]) {
      expect(isSignedIn(states[key] as AppSessionState)).toBe(true);
    }
  });

  it('identifies a club user only when the club is fully resolved', () => {
    expect(isTenantUser(states.owner as AppSessionState)).toBe(true);
    expect(isTenantUser(states.receptionist as AppSessionState)).toBe(true);

    // A suspended club has a tenant, but is deliberately not a usable session.
    expect(isTenantUser(states.suspended as AppSessionState)).toBe(false);
    expect(isTenantUser(states.noTenant as AppSessionState)).toBe(false);
    expect(isTenantUser(states.platform as AppSessionState)).toBe(false);
    // Reaching several clubs is not the same as operating one.
    expect(isTenantUser(states.selection as AppSessionState)).toBe(false);
  });

  it('identifies the platform operator, who is never a club user', () => {
    expect(isPlatformAdmin(states.platform as AppSessionState)).toBe(true);
    expect(isTenantUser(states.platform as AppSessionState)).toBe(false);
    expect(isPlatformAdmin(states.owner as AppSessionState)).toBe(false);
  });

  it('grants club management to the owner and nobody else', () => {
    expect(canManageClub(states.owner as AppSessionState)).toBe(true);
    expect(canManageClub(states.receptionist as AppSessionState)).toBe(false);
    // A platform operator administers clubs; it is not a club manager.
    expect(canManageClub(states.platform as AppSessionState)).toBe(false);
    expect(canManageClub(states.suspended as AppSessionState)).toBe(false);
  });

  it('narrows the union so club data is only reachable in the right state', () => {
    const state = states.owner as AppSessionState;
    if (isTenantUser(state)) {
      // Compiles only because the variant carries these fields.
      expect(state.tenant.id).toBe('tenant-1');
      expect(state.role).toBe('OWNER');
    } else {
      throw new Error('expected a tenant user');
    }
  });

  it('exposes the active club id only while a club is actually being operated', () => {
    expect(activeTenantId(states.owner as AppSessionState)).toBe('tenant-1');
    // A suspended club is named, but no work happens in it.
    expect(activeTenantId(states.suspended as AppSessionState)).toBeNull();
    expect(activeTenantId(states.selection as AppSessionState)).toBeNull();
    expect(activeTenantId(states.platform as AppSessionState)).toBeNull();
  });

  it('offers switching only when there is somewhere to switch to', () => {
    const single = tenantUser('OWNER', [club('tenant-1', 'Royal')]);
    const several = tenantUser('OWNER', [club('tenant-1', 'Royal'), club('tenant-2', 'Blue Cue')]);

    expect(isTenantUser(single) && single.canSwitchClubs).toBe(false);
    expect(isTenantUser(several) && several.canSwitchClubs).toBe(true);
  });
});

describe('isOperable', () => {
  it('admits clubs that are live or on trial', () => {
    expect(isOperable(club('t', 'Live', 'ACTIVE'))).toBe(true);
    expect(isOperable(club('t', 'Trialling', 'TRIAL'))).toBe(true);
  });

  it('excludes clubs the platform has stopped', () => {
    // A membership survives suspension - the club must still not be workable.
    expect(isOperable(club('t', 'Suspended', 'SUSPENDED'))).toBe(false);
    expect(isOperable(club('t', 'Archived', 'ARCHIVED'))).toBe(false);
  });
});
