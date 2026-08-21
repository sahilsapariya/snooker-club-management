import { unwrap } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import type { Database } from '@/types/database.types';

export type Equipment = Database['public']['Tables']['equipment']['Row'];
export type EquipmentCategory = Database['public']['Enums']['equipment_category'];
export type EquipmentStatus = Database['public']['Enums']['equipment_status'];

/**
 * The club's assets: cues, rests, ball sets, and whatever else it owns.
 *
 * Two audiences write here, and the database draws the line between them
 * (migration 0025) rather than this file:
 *
 *   any member   may report a change of condition, and note why
 *   the owner    adds, prices, reassigns and retires
 *
 * That split exists because the thing that actually happens with a cue is a
 * receptionist picking it up mid-shift and finding the tip gone. Making them
 * phone the owner to record that is how the register stops matching the rack -
 * and a register nobody maintains is worse than none, because people trust it.
 */

/** Everything, including retired items so an owner can bring one back. */
export async function fetchEquipment(tenantId: string): Promise<Equipment[]> {
  const result = await supabase
    .from('equipment')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('category', { ascending: true })
    .order('name', { ascending: true });

  return unwrap(result, 'load equipment') ?? [];
}

export interface CreateEquipmentInput {
  readonly tenantId: string;
  readonly category: EquipmentCategory;
  readonly name: string;
  readonly assetCode: string | null;
  readonly assignedTableId: string | null;
  readonly purchasePriceMinor: number | null;
  readonly purchasedAt: string | null;
  readonly notes: string | null;
}

export async function createEquipment(input: CreateEquipmentInput): Promise<Equipment> {
  const result = await supabase
    .from('equipment')
    .insert({
      tenant_id: input.tenantId,
      category: input.category,
      name: input.name.trim(),
      asset_code: input.assetCode,
      assigned_table_id: input.assignedTableId,
      purchase_price_minor: input.purchasePriceMinor,
      purchased_at: input.purchasedAt,
      notes: input.notes,
    })
    .select('*')
    .single();

  return unwrap(result, 'add equipment');
}

export interface UpdateEquipmentInput {
  readonly equipmentId: string;
  readonly category?: EquipmentCategory;
  readonly name?: string;
  readonly assetCode?: string | null;
  readonly assignedTableId?: string | null;
  readonly purchasePriceMinor?: number | null;
  readonly purchasedAt?: string | null;
  readonly status?: EquipmentStatus;
  readonly notes?: string | null;
}

/**
 * Note what is absent: `retired_at`.
 *
 * It is derived from the status by a trigger, so retiring is one field rather
 * than two the caller has to keep in step. `equipment_retired_consistency`
 * would otherwise reject the first caller who remembered only one of them, with
 * a constraint name for a message.
 */
export async function updateEquipment(input: UpdateEquipmentInput): Promise<Equipment> {
  const result = await supabase
    .from('equipment')
    .update({
      ...opt('category', input.category),
      ...(input.name === undefined ? {} : { name: input.name.trim() }),
      ...opt('asset_code', input.assetCode),
      ...opt('assigned_table_id', input.assignedTableId),
      ...opt('purchase_price_minor', input.purchasePriceMinor),
      ...opt('purchased_at', input.purchasedAt),
      ...opt('status', input.status),
      ...opt('notes', input.notes),
    })
    .eq('id', input.equipmentId)
    .select('*')
    .single();

  return unwrap(result, 'update equipment');
}

// `undefined` means "not being changed"; `null` is a real value here - clearing
// an asset code, or unassigning from a table - so it has to survive.
function opt<K extends string, V>(key: K, value: V | undefined) {
  return value === undefined ? {} : ({ [key]: value } as Record<K, V>);
}
