import { AppError, toAppError, unwrap } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { supabase } from '@/lib/supabase';

import type {
  AccessibleClub,
  BillingSettings,
  PlatformAdmin,
  Profile,
  SessionIdentity,
  Tenant,
  TenantMembership,
} from '../model/types';

const log = logger.child('auth:context');

interface MembershipRow extends TenantMembership {
  readonly tenant: Tenant | null;
}

/**
 * Resolves who the signed-in user is, and every club they can reach.
 *
 * Note what is NOT happening here: the client does not tell the server which
 * tenant it wants, and it does not read a role out of the JWT. It asks three
 * questions it is allowed to ask, and Row Level Security decides what comes
 * back. A user with no membership simply receives no membership rows - there is
 * nothing to spoof.
 *
 * This is keyed by user, not by club. Switching club must not refetch it, which
 * is why the active club is applied later, in `useAppSession`.
 */
export async function resolveSessionIdentity(userId: string): Promise<SessionIdentity> {
  const [profile, platformAdmin, memberships] = await Promise.all([
    fetchProfile(userId),
    fetchPlatformAdmin(userId),
    fetchMemberships(userId),
  ]);

  if (!profile) {
    // The auth.users trigger creates this row, so its absence means the
    // account was provisioned outside the normal path.
    throw new AppError({
      code: 'auth/no-tenant',
      message: 'This account is not set up yet. Contact your club owner.',
      technicalMessage: `No public.profiles row for auth user ${userId}`,
    });
  }

  const clubs: AccessibleClub[] = memberships
    .filter((row): row is MembershipRow & { tenant: Tenant } => row.tenant !== null)
    .map((row) => ({ tenant: row.tenant, membership: row, role: row.role }))
    .sort((a, b) => a.tenant.name.localeCompare(b.tenant.name));

  log.info('Resolved identity', {
    isPlatformAdmin: platformAdmin !== null,
    clubs: clubs.length,
  });

  return { profile, platformAdmin, clubs };
}

async function fetchProfile(userId: string): Promise<Profile | null> {
  const result = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
  return unwrap(result, 'load profile');
}

async function fetchPlatformAdmin(userId: string): Promise<PlatformAdmin | null> {
  const result = await supabase
    .from('platform_admins')
    .select('*')
    .eq('user_id', userId)
    .eq('is_active', true)
    .maybeSingle();
  return unwrap(result, 'load platform admin');
}

/**
 * Every active membership, with its club.
 *
 * No `limit(1)`: an owner may run several clubs on one login. The receptionist
 * case is constrained in the database, not here.
 */
async function fetchMemberships(userId: string): Promise<MembershipRow[]> {
  const result = await supabase
    .from('tenant_memberships')
    .select('*, tenant:tenants(*)')
    .eq('user_id', userId)
    .eq('status', 'ACTIVE')
    .order('created_at', { ascending: true });

  return (unwrap(result, 'load club memberships') ?? []) as MembershipRow[];
}

/**
 * Billing rules for one club.
 *
 * Fetched separately from identity because it is club-scoped, not user-scoped -
 * switching club must refetch this but not the membership set. Readable only
 * while the club is active, which is why a suspended club yields null rather
 * than an error.
 */
export async function fetchBillingSettings(tenantId: string): Promise<BillingSettings | null> {
  try {
    const result = await supabase
      .from('tenant_billing_settings')
      .select('*')
      .eq('tenant_id', tenantId)
      .maybeSingle();
    return unwrap(result, 'load billing settings');
  } catch (error) {
    log.warn('Could not load billing settings', {
      tenantId,
      error: String(toAppError(error).code),
    });
    return null;
  }
}
