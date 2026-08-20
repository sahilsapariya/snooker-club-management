import { unwrap } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import type { Database } from '@/types/database.types';

export type ClubTableOverview = Database['public']['Views']['v_club_table_overview']['Row'];
export type TableType = Database['public']['Tables']['table_types']['Row'];

/**
 * Data access for the Tables screen.
 *
 * The `tenant_id` filter here is a query optimisation and a readability aid -
 * it is NOT what keeps clubs apart. Row Level Security already restricts
 * `v_club_table_overview` (declared `security_invoker`) to the caller's own
 * club, so removing this `.eq()` would change nothing about what comes back.
 */
export async function fetchClubTableOverview(tenantId: string): Promise<ClubTableOverview[]> {
  const result = await supabase
    .from('v_club_table_overview')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });

  return unwrap(result, 'load club tables') ?? [];
}

export async function fetchTableTypes(tenantId: string): Promise<TableType[]> {
  const result = await supabase
    .from('table_types')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .order('sort_order', { ascending: true });

  return unwrap(result, 'load table types') ?? [];
}
