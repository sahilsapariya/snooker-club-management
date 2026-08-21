import { unwrap } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import type { Database } from '@/types/database.types';

export type Tenant = Database['public']['Tables']['tenants']['Row'];
export type TenantStatus = Database['public']['Enums']['tenant_status'];

/**
 * Platform administration data access.
 *
 * Note that the write paths are RPCs, not table updates. `public.tenants` has
 * INSERT/UPDATE/DELETE revoked from the `authenticated` role entirely, so
 * branding and status can only change through these SECURITY DEFINER functions,
 * each of which re-checks `app.is_platform_admin()` in the database.
 *
 * The practical consequence: there is no client-side code path - correct,
 * buggy or malicious - by which a club owner can rebrand their own club.
 */

export async function fetchAllTenants(): Promise<Tenant[]> {
  const result = await supabase.from('tenants').select('*').order('name', { ascending: true });
  return unwrap(result, 'load tenants') ?? [];
}

export async function fetchTenant(tenantId: string): Promise<Tenant | null> {
  const result = await supabase.from('tenants').select('*').eq('id', tenantId).maybeSingle();
  return unwrap(result, 'load tenant');
}

export interface CreateTenantInput {
  readonly name: string;
  readonly slug: string;
  readonly primaryColor?: string;
  readonly secondaryColor?: string;
  readonly currencyCode?: string;
  readonly timezone?: string;
  readonly status?: TenantStatus;
}

export async function createTenant(input: CreateTenantInput): Promise<Tenant> {
  const result = await supabase.rpc('platform_create_tenant', {
    p_name: input.name,
    p_slug: input.slug,
    ...(input.primaryColor === undefined ? {} : { p_primary_color: input.primaryColor }),
    ...(input.secondaryColor === undefined ? {} : { p_secondary_color: input.secondaryColor }),
    ...(input.currencyCode === undefined ? {} : { p_currency_code: input.currencyCode }),
    ...(input.timezone === undefined ? {} : { p_timezone: input.timezone }),
    ...(input.status === undefined ? {} : { p_status: input.status }),
  });

  return unwrap(result, 'create tenant');
}

/**
 * Fields to change. Omitted fields are left alone.
 *
 * `platform_update_tenant` coalesces its arguments onto the existing row, so
 * NULL means "leave unchanged" rather than "clear". Removing a logo therefore
 * needs its own flag - passing an empty string would store an empty string, and
 * passing null would do nothing at all.
 */
export interface UpdateTenantBrandingInput {
  readonly tenantId: string;
  readonly name?: string;
  readonly logoUrl?: string;
  readonly clearLogo?: boolean;
  readonly primaryColor?: string;
  readonly secondaryColor?: string;
  readonly themePreset?: string;
  readonly currencyCode?: string;
  readonly timezone?: string;
  readonly contactName?: string;
  readonly contactEmail?: string;
  readonly contactPhone?: string;
  readonly addressLine1?: string;
  readonly city?: string;
  readonly state?: string;
}

export async function updateTenantBranding(input: UpdateTenantBrandingInput): Promise<Tenant> {
  const result = await supabase.rpc('platform_update_tenant', {
    p_tenant_id: input.tenantId,
    ...optional('p_name', input.name),
    ...optional('p_logo_url', input.logoUrl),
    ...optional('p_clear_logo', input.clearLogo),
    ...optional('p_primary_color', input.primaryColor),
    ...optional('p_secondary_color', input.secondaryColor),
    ...optional('p_theme_preset', input.themePreset),
    ...optional('p_currency_code', input.currencyCode),
    ...optional('p_timezone', input.timezone),
    ...optional('p_contact_name', input.contactName),
    ...optional('p_contact_email', input.contactEmail),
    ...optional('p_contact_phone', input.contactPhone),
    ...optional('p_address_line1', input.addressLine1),
    ...optional('p_city', input.city),
    ...optional('p_state', input.state),
  });

  return unwrap(result, 'update tenant branding');
}

function optional<K extends string, V>(key: K, value: V | undefined) {
  return value === undefined || value === '' ? {} : ({ [key]: value } as Record<K, V>);
}

export async function setTenantStatus(tenantId: string, status: TenantStatus): Promise<Tenant> {
  const result = await supabase.rpc('platform_set_tenant_status', {
    p_tenant_id: tenantId,
    p_status: status,
  });

  return unwrap(result, 'set tenant status');
}

/** Links an existing Supabase Auth account to a club. Owner or platform admin. */
export async function addTenantMember(params: {
  readonly tenantId: string;
  readonly email: string;
  readonly role: Database['public']['Enums']['tenant_role'];
}) {
  const result = await supabase.rpc('add_tenant_member', {
    p_tenant_id: params.tenantId,
    p_email: params.email,
    p_role: params.role,
  });

  return unwrap(result, 'add tenant member');
}
