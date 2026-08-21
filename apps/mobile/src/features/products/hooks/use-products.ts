import { useQuery } from '@tanstack/react-query';

import { queryKeys } from '@/lib/query';

import { fetchLowStockProducts, fetchProductCategories, fetchProducts } from '../api/products.api';

export function useProducts(tenantId: string | null) {
  return useQuery({
    queryKey: queryKeys.products.all(tenantId ?? 'none'),
    queryFn: () => fetchProducts(tenantId as string),
    enabled: tenantId !== null,
    // The catalogue changes rarely; stock moves with every sale, and selling
    // invalidates this key explicitly rather than relying on a short staleTime.
    staleTime: 2 * 60_000,
  });
}

export function useProductCategories(tenantId: string | null) {
  return useQuery({
    queryKey: queryKeys.products.categories(tenantId ?? 'none'),
    queryFn: () => fetchProductCategories(tenantId as string),
    enabled: tenantId !== null,
    staleTime: 10 * 60_000,
  });
}

export function useLowStockProducts(tenantId: string | null) {
  return useQuery({
    queryKey: queryKeys.products.lowStock(tenantId ?? 'none'),
    queryFn: () => fetchLowStockProducts(tenantId as string),
    enabled: tenantId !== null,
    staleTime: 60_000,
  });
}
