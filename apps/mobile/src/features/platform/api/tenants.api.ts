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
  const result = await supabase
    .rpc('platform_create_tenant', {
      p_name: input.name,
      p_slug: input.slug,
      ...(input.primaryColor === undefined ? {} : { p_primary_color: input.primaryColor }),
      ...(input.secondaryColor === undefined ? {} : { p_secondary_color: input.secondaryColor }),
      ...(input.currencyCode === undefined ? {} : { p_currency_code: input.currencyCode }),
      ...(input.timezone === undefined ? {} : { p_timezone: input.timezone }),
      ...(input.status === undefined ? {} : { p_status: input.status }),
    })
    .single();

  return unwrap(result, 'create tenant');
}

/**
 * Fields to change. Omitted fields are left alone.
 *
 * There is deliberately no `null` here: `platform_update_tenant` coalesces its
 * arguments onto the existing row, so passing null would mean "leave unchanged"
 * rather than "clear". Clearing an optional field (removing a logo, say) needs
 * an explicit clear flag on the SQL function and is not supported yet.
 */
export interface UpdateTenantBrandingInput {
  readonly tenantId: string;
  readonly name?: string;
  readonly logoUrl?: string;
  readonly primaryColor?: string;
  readonly secondaryColor?: string;
  readonly themePreset?: string;
  readonly contactName?: string;
  readonly contactEmail?: string;
  readonly contactPhone?: string;
}

export async function updateTenantBranding(input: UpdateTenantBrandingInput): Promise<Tenant> {
  const result = await supabase
    .rpc('platform_update_tenant', {
      p_tenant_id: input.tenantId,
      ...(input.name === undefined ? {} : { p_name: input.name }),
      ...(input.logoUrl === undefined ? {} : { p_logo_url: input.logoUrl }),
      ...(input.primaryColor === undefined ? {} : { p_primary_color: input.primaryColor }),
      ...(input.secondaryColor === undefined ? {} : { p_secondary_color: input.secondaryColor }),
      ...(input.themePreset === undefined ? {} : { p_theme_preset: input.themePreset }),
      ...(input.contactName === undefined ? {} : { p_contact_name: input.contactName }),
      ...(input.contactEmail === undefined ? {} : { p_contact_email: input.contactEmail }),
      ...(input.contactPhone === undefined ? {} : { p_contact_phone: input.contactPhone }),
    })
    .single();

  return unwrap(result, 'update tenant branding');
}

export async function setTenantStatus(tenantId: string, status: TenantStatus): Promise<Tenant> {
  const result = await supabase
    .rpc('platform_set_tenant_status', { p_tenant_id: tenantId, p_status: status })
    .single();

  return unwrap(result, 'set tenant status');
}

/** Links an existing Supabase Auth account to a club. Owner or platform admin. */
export async function addTenantMember(params: {
  readonly tenantId: string;
  readonly email: string;
  readonly role: Database['public']['Enums']['tenant_role'];
}) {
  const result = await supabase
    .rpc('add_tenant_member', {
      p_tenant_id: params.tenantId,
      p_email: params.email,
      p_role: params.role,
    })
    .single();

  return unwrap(result, 'add tenant member');
}
