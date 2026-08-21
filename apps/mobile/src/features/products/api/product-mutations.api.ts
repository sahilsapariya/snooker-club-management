import { unwrap } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import type { Database } from '@/types/database.types';

type MovementType = Database['public']['Enums']['inventory_movement_type'];
export type Product = Database['public']['Tables']['products']['Row'];
export type InventoryMovement = Database['public']['Tables']['inventory_movements']['Row'];

/**
 * Owner-only catalogue management.
 *
 * RLS already restricts every write here to OWNER (and rejects receptionists),
 * so these functions do not re-check the role - doing so in the client would
 * only duplicate a rule the database already enforces, and would drift from it.
 */

export interface UpsertProductInput {
  readonly tenantId: string;
  readonly id?: string;
  readonly categoryId: string | null;
  readonly name: string;
  readonly sellingPriceMinor: number;
  readonly costPriceMinor: number | null;
  readonly lowStockThreshold: number;
  readonly unit: string;
  readonly trackInventory: boolean;
}

export async function createProduct(input: UpsertProductInput): Promise<Product> {
  const result = await supabase
    .from('products')
    .insert({
      tenant_id: input.tenantId,
      category_id: input.categoryId,
      name: input.name,
      selling_price_minor: input.sellingPriceMinor,
      cost_price_minor: input.costPriceMinor,
      low_stock_threshold: input.lowStockThreshold,
      unit: input.unit,
      track_inventory: input.trackInventory,
    })
    .select('*')
    .single();

  return unwrap(result, 'create product');
}

/**
 * Updates a product.
 *
 * `stock_quantity` is deliberately not settable: it is a projection of the
 * inventory ledger, maintained by trigger. Correcting stock means posting an
 * adjustment movement (see `adjustStock`), which leaves an audit trail, rather
 * than silently overwriting the number.
 */
export async function updateProduct(input: UpsertProductInput & { id: string }): Promise<Product> {
  const result = await supabase
    .from('products')
    .update({
      category_id: input.categoryId,
      name: input.name,
      selling_price_minor: input.sellingPriceMinor,
      cost_price_minor: input.costPriceMinor,
      low_stock_threshold: input.lowStockThreshold,
      unit: input.unit,
      track_inventory: input.trackInventory,
    })
    .eq('id', input.id)
    .select('*')
    .single();

  return unwrap(result, 'update product');
}

/**
 * Retires a product without deleting it.
 *
 * Deleting would break every historical `session_items` row that references it,
 * and those rows are financial history. Deactivating hides it from the till and
 * leaves the past intact.
 */
export async function setProductActive(productId: string, isActive: boolean): Promise<Product> {
  const result = await supabase
    .from('products')
    .update({ is_active: isActive })
    .eq('id', productId)
    .select('*')
    .single();

  return unwrap(result, isActive ? 'restore product' : 'retire product');
}

export interface StockMovementInput {
  readonly tenantId: string;
  readonly productId: string;
  readonly movementType: MovementType;
  /** Signed: positive receives stock, negative removes it. */
  readonly quantityDelta: number;
  readonly unitCostMinor: number | null;
  readonly note: string | null;
  readonly createdBy: string;
}

/**
 * Posts a stock movement. This is the ONLY way stock changes.
 *
 * The ledger is append-only - UPDATE and DELETE are revoked from
 * `authenticated` - so a correction is a new compensating row, never an edit.
 * A trigger updates `products.stock_quantity` from it.
 */
export async function postStockMovement(input: StockMovementInput): Promise<InventoryMovement> {
  const result = await supabase
    .from('inventory_movements')
    .insert({
      tenant_id: input.tenantId,
      product_id: input.productId,
      movement_type: input.movementType,
      quantity_delta: input.quantityDelta,
      unit_cost_minor: input.unitCostMinor,
      note: input.note,
      created_by: input.createdBy,
      reference_type: 'manual',
    })
    .select('*')
    .single();

  return unwrap(result, 'post stock movement');
}

export async function fetchStockHistory(
  productId: string,
  limit = 50,
): Promise<InventoryMovement[]> {
  const result = await supabase
    .from('inventory_movements')
    .select('*')
    .eq('product_id', productId)
    .order('created_at', { ascending: false })
    .limit(limit);

  return unwrap(result, 'load stock history') ?? [];
}
