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

// ===========================================================================
// Owner table management
// ===========================================================================
// Writes go directly to `club_tables` rather than through an RPC, because RLS
// already says exactly the right thing: since migration 0015 the insert, update
// and delete policies on this table require `app.is_tenant_owner(tenant_id)`.
// A receptionist's write is refused by Postgres, and a platform admin's is too
// - the platform brands and suspends clubs, it does not arrange their furniture.

export type ClubTable = Database['public']['Tables']['club_tables']['Row'];

/** Every table, including deactivated ones, so an owner can bring one back. */
export async function fetchAllClubTables(tenantId: string): Promise<ClubTable[]> {
  const result = await supabase
    .from('club_tables')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });

  return unwrap(result, 'load club tables') ?? [];
}

export interface CreateClubTableInput {
  readonly tenantId: string;
  readonly tableTypeId: string;
  readonly name: string;
  readonly tableNumber: number | null;
  readonly sortOrder: number;
  readonly notes: string | null;
}

export async function createClubTable(input: CreateClubTableInput): Promise<ClubTable> {
  const result = await supabase
    .from('club_tables')
    .insert({
      tenant_id: input.tenantId,
      table_type_id: input.tableTypeId,
      name: input.name.trim(),
      table_number: input.tableNumber,
      sort_order: input.sortOrder,
      notes: input.notes,
    })
    .select('*')
    .single();

  return unwrap(result, 'add table');
}

export interface UpdateClubTableInput {
  readonly tableId: string;
  readonly name?: string;
  readonly tableTypeId?: string;
  readonly tableNumber?: number | null;
  readonly sortOrder?: number;
  readonly notes?: string | null;
  readonly isActive?: boolean;
}

export async function updateClubTable(input: UpdateClubTableInput): Promise<ClubTable> {
  const result = await supabase
    .from('club_tables')
    .update({
      ...(input.name === undefined ? {} : { name: input.name.trim() }),
      ...(input.tableTypeId === undefined ? {} : { table_type_id: input.tableTypeId }),
      ...(input.tableNumber === undefined ? {} : { table_number: input.tableNumber }),
      ...(input.sortOrder === undefined ? {} : { sort_order: input.sortOrder }),
      ...(input.notes === undefined ? {} : { notes: input.notes }),
      ...(input.isActive === undefined ? {} : { is_active: input.isActive }),
    })
    .eq('id', input.tableId)
    .select('*')
    .single();

  return unwrap(result, 'update table');
}

/**
 * Retires a table without erasing what happened on it.
 *
 * There is no hard delete in this app. `sessions` references `club_tables` with
 * `on delete no action`, so Postgres would refuse to remove a table that has
 * ever been played on anyway - deactivating is the operation that actually
 * matches what an owner means by "we got rid of that table".
 */
export async function setClubTableActive(tableId: string, isActive: boolean): Promise<ClubTable> {
  return updateClubTable({ tableId, isActive });
}
