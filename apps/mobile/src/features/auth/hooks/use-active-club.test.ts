import { resolveActiveClub } from './use-active-club';

import type { AccessibleClub, Tenant, TenantMembership } from '../model/types';

/**
 * Which club a multi-club owner lands in. Getting this wrong either strands an
 * owner on a selector they cannot dismiss, or drops them into a club they did
 * not choose - so every branch is pinned here rather than exercised through the
 * store.
 */

const club = (id: string): AccessibleClub => ({
  tenant: { id, name: `Club ${id}`, status: 'ACTIVE' } as Tenant,
  membership: { id: `m-${id}`, tenant_id: id, user_id: 'user-1' } as TenantMembership,
  role: 'OWNER',
});

describe('resolveActiveClub', () => {
  it('resolves nothing when the user reaches no club', () => {
    expect(resolveActiveClub([], null)).toBeNull();
    // Even a remembered club cannot rescue an empty membership set.
    expect(resolveActiveClub([], 'tenant-1')).toBeNull();
  });

  it('goes straight into a single club without asking', () => {
    const only = club('tenant-1');
    expect(resolveActiveClub([only], null)).toBe(only);
  });

  it('honours the remembered club when it is still reachable', () => {
    const clubs = [club('tenant-1'), club('tenant-2'), club('tenant-3')];
    expect(resolveActiveClub(clubs, 'tenant-2')).toBe(clubs[1]);
  });

  it('falls back to the selector when the remembered club is gone', () => {
    // Membership revoked, or the club suspended between app launches.
    const clubs = [club('tenant-1'), club('tenant-2')];
    expect(resolveActiveClub(clubs, 'tenant-9')).toBeNull();
  });

  it('still auto-selects the one remaining club when the remembered one is gone', () => {
    const remaining = club('tenant-1');
    expect(resolveActiveClub([remaining], 'tenant-9')).toBe(remaining);
  });

  it('asks a multi-club owner to choose rather than guessing', () => {
    expect(resolveActiveClub([club('tenant-1'), club('tenant-2')], null)).toBeNull();
  });
});
