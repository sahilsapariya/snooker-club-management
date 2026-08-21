import { unwrap } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import type { Database } from '@/types/database.types';

export type Product = Database['public']['Tables']['products']['Row'];
export type ProductCategory = Database['public']['Tables']['product_categories']['Row'];
export type LowStockProduct = Database['public']['Views']['v_low_stock_products']['Row'];

export interface ProductWithCategory extends Product {
  readonly category: { id: string; name: string } | null;
}

/**
 * Product catalogue access.
 *
 * Read-heavy by design: receptionists sell from this list all evening but only
 * an owner may change it, which RLS enforces. `stock_quantity` here is a cached
 * projection of the `inventory_movements` ledger - selling through
 * `addSessionItem` posts the movement, and a trigger updates this number. It is
 * never written directly from the client.
 */

export async function fetchProducts(tenantId: string): Promise<ProductWithCategory[]> {
  const result = await supabase
    .from('products')
    .select('*, category:product_categories(id, name)')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .order('name', { ascending: true });

  return (unwrap(result, 'load products') ?? []) as ProductWithCategory[];
}

export async function fetchProductCategories(tenantId: string): Promise<ProductCategory[]> {
  const result = await supabase
    .from('product_categories')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .order('sort_order', { ascending: true });

  return unwrap(result, 'load product categories') ?? [];
}

/** Products at or below their configured threshold, for the low-stock alert. */
export async function fetchLowStockProducts(tenantId: string): Promise<LowStockProduct[]> {
  const result = await supabase
    .from('v_low_stock_products')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('name', { ascending: true });

  return unwrap(result, 'load low stock products') ?? [];
}
