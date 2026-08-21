import { unwrap } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import type { Database } from '@/types/database.types';

type Fn = Database['public']['Functions'];
type Tables = Database['public']['Tables'];

type Tenant = Tables['tenants']['Row'];

export type PlatformOverview = Fn['platform_overview']['Returns'][number];
export type PlatformOwner = Fn['platform_owners']['Returns'][number];
export type PlatformOwnerClub = Fn['platform_owner_clubs']['Returns'][number];
export type PlatformClub = Fn['platform_clubs']['Returns'][number];
export type TenantStatus = Database['public']['Enums']['tenant_status'];

/**
 * Platform administration: the owner→club relationship.
 *
 * Every function here is an RPC rather than a table read or write, for two
 * different reasons.
 *
 * The reads are RPCs because they answer questions that span tables the client
 * would otherwise have to join by hand - and because counting a club's staff or
 * tables through PostgREST would leak the shape of clubs the caller may not
 * see. They are all SECURITY INVOKER, so a club owner calling `platform_clubs`
 * gets their own clubs and nothing else; the platform sees everything because
 * RLS says so, not because the client asked nicely.
 *
 * The writes are RPCs because `public.tenants` has INSERT/UPDATE/DELETE revoked
 * from the `authenticated` role outright. There is no client code path -
 * correct, buggy, or hostile - by which a club owner can create a club, rebrand
 * one, or change who owns it.
 */

export async function fetchPlatformOverview(): Promise<PlatformOverview | null> {
  const result = await supabase.rpc('platform_overview').maybeSingle();
  return unwrap(result, 'load platform overview');
}

export async function fetchPlatformOwners(): Promise<PlatformOwner[]> {
  const result = await supabase.rpc('platform_owners');
  return unwrap(result, 'load owners') ?? [];
}

export async function fetchOwnerClubs(ownerUserId: string): Promise<PlatformOwnerClub[]> {
  const result = await supabase.rpc('platform_owner_clubs', { p_owner_user_id: ownerUserId });
  return unwrap(result, 'load the clubs for this owner') ?? [];
}

export async function fetchPlatformClubs(): Promise<PlatformClub[]> {
  const result = await supabase.rpc('platform_clubs');
  return unwrap(result, 'load clubs') ?? [];
}

/**
 * Everything needed to stand a club up, in one transaction.
 *
 * The owner is identified by email rather than by id: the platform operator is
 * looking at an onboarding form, not a database. If no account exists for that
 * address the function raises `P0002` with a hint, rather than silently
 * creating an ownerless club.
 */
export interface CreateClubInput {
  readonly name: string;
  readonly slug: string;
  readonly ownerEmail: string;
  readonly primaryColor?: string;
  readonly secondaryColor?: string;
  readonly logoUrl?: string;
  readonly themePreset?: string;
  readonly currencyCode?: string;
  readonly timezone?: string;
  readonly status?: TenantStatus;
  readonly contactName?: string;
  readonly contactEmail?: string;
  readonly contactPhone?: string;
  readonly addressLine1?: string;
  readonly city?: string;
  readonly state?: string;
}

export async function createClub(input: CreateClubInput): Promise<Tenant> {
  const result = await supabase.rpc('platform_create_club', {
    p_name: input.name,
    p_slug: input.slug,
    p_owner_email: input.ownerEmail,
    ...optional('p_primary_color', input.primaryColor),
    ...optional('p_secondary_color', input.secondaryColor),
    ...optional('p_logo_url', input.logoUrl),
    ...optional('p_theme_preset', input.themePreset),
    ...optional('p_currency_code', input.currencyCode),
    ...optional('p_timezone', input.timezone),
    ...optional('p_status', input.status),
    ...optional('p_contact_name', input.contactName),
    ...optional('p_contact_email', input.contactEmail),
    ...optional('p_contact_phone', input.contactPhone),
    ...optional('p_address_line1', input.addressLine1),
    ...optional('p_city', input.city),
    ...optional('p_state', input.state),
  });

  return unwrap(result, 'create club');
}

/**
 * Moves a club to a different owner, or adds a second one.
 *
 * `replaceExisting` is explicit rather than inferred because the two cases are
 * genuinely different commercial events: a sale (replace) and a partnership
 * (add). Guessing would be wrong half the time.
 */
export async function assignOwner(params: {
  readonly tenantId: string;
  readonly ownerEmail: string;
  readonly replaceExisting: boolean;
}) {
  const result = await supabase.rpc('platform_assign_owner', {
    p_tenant_id: params.tenantId,
    p_owner_email: params.ownerEmail,
    p_replace_existing: params.replaceExisting,
  });

  return unwrap(result, 'assign club owner');
}

/** Disables an owner's account across every club they run, or restores it. */
export async function setOwnerActive(ownerUserId: string, isActive: boolean) {
  const result = await supabase.rpc('platform_set_owner_active', {
    p_owner_user_id: ownerUserId,
    p_is_active: isActive,
  });

  return unwrap(result, 'update owner account');
}

function optional<K extends string, V>(key: K, value: V | undefined) {
  return value === undefined || value === '' ? {} : ({ [key]: value } as Record<K, V>);
}
