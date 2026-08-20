import { AppError, toAppError, unwrap } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { supabase } from '@/lib/supabase';

import type {
  AppSessionState,
  BillingSettings,
  PlatformAdmin,
  Profile,
  Tenant,
  TenantMembership,
} from '../model/types';

const log = logger.child('auth:context');

interface MembershipWithTenant extends TenantMembership {
  readonly tenant: Tenant | null;
}

/**
 * Resolves who the signed-in user is.
 *
 * Note what is NOT happening here: the client does not tell the server which
 * tenant it wants, and it does not read a role out of the JWT. It asks three
 * questions it is allowed to ask, and Row Level Security decides what comes
 * back. A user with no membership simply receives no membership rows - there is
 * nothing to spoof.
 *
 * The three reads are independent, so they are issued together.
 */
export async function resolveSessionContext(userId: string): Promise<AppSessionState> {
  try {
    const [profile, platformAdmin, membership] = await Promise.all([
      fetchProfile(userId),
      fetchPlatformAdmin(userId),
      fetchMembership(userId),
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

    if (!profile.is_active) {
      log.info('Signed-in account is disabled', { userId });
      return { status: 'account-disabled', profile };
    }

    if (platformAdmin) {
      log.info('Resolved a platform operator', { role: platformAdmin.role });
      return { status: 'platform-admin', profile, platformRole: platformAdmin.role };
    }

    if (!membership || !membership.tenant) {
      log.info('Signed-in account has no club membership', { userId });
      return { status: 'no-tenant', profile };
    }

    const tenant = membership.tenant;

    if (tenant.status !== 'ACTIVE' && tenant.status !== 'TRIAL') {
      log.info('Club is not currently active', { tenantId: tenant.id, status: tenant.status });
      return { status: 'tenant-suspended', profile, tenant };
    }

    // Billing settings are readable only while the club is active, which is why
    // this is fetched after the status check rather than alongside the rest.
    const billingSettings = await fetchBillingSettings(tenant.id);

    log.info('Resolved a club user', { tenantId: tenant.id, role: membership.role });
    return {
      status: 'tenant-user',
      profile,
      tenant,
      membership,
      role: membership.role,
      billingSettings,
    };
  } catch (error) {
    const appError = toAppError(error, 'We could not load your account.');
    log.error('Failed to resolve the session context', appError);
    return { status: 'error', error: appError };
  }
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

async function fetchMembership(userId: string): Promise<MembershipWithTenant | null> {
  // One active membership per user today. `limit(1)` plus `maybeSingle()` keeps
  // this correct if that constraint is relaxed for multi-club staff later.
  const result = await supabase
    .from('tenant_memberships')
    .select('*, tenant:tenants(*)')
    .eq('user_id', userId)
    .eq('status', 'ACTIVE')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  return unwrap(result, 'load tenant membership');
}

async function fetchBillingSettings(tenantId: string): Promise<BillingSettings | null> {
  const result = await supabase
    .from('tenant_billing_settings')
    .select('*')
    .eq('tenant_id', tenantId)
    .maybeSingle();
  return unwrap(result, 'load billing settings');
}
