import { useMutation, useQueryClient } from '@tanstack/react-query';

import { queryKeys } from '@/lib/query';

import {
  createProduct,
  postStockMovement,
  setProductActive,
  updateProduct,
  type StockMovementInput,
  type UpsertProductInput,
} from '../api/product-mutations.api';

function useProductInvalidator(tenantId: string | null) {
  const queryClient = useQueryClient();
  return async () => {
    if (!tenantId) return;
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.products.all(tenantId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.products.lowStock(tenantId) }),
    ]);
  };
}

export function useCreateProduct(tenantId: string | null) {
  const invalidate = useProductInvalidator(tenantId);
  return useMutation({
    mutationFn: (input: UpsertProductInput) => createProduct(input),
    onSuccess: invalidate,
  });
}

export function useUpdateProduct(tenantId: string | null) {
  const invalidate = useProductInvalidator(tenantId);
  return useMutation({
    mutationFn: (input: UpsertProductInput & { id: string }) => updateProduct(input),
    onSuccess: invalidate,
  });
}

export function useSetProductActive(tenantId: string | null) {
  const invalidate = useProductInvalidator(tenantId);
  return useMutation({
    mutationFn: ({ productId, isActive }: { productId: string; isActive: boolean }) =>
      setProductActive(productId, isActive),
    onSuccess: invalidate,
  });
}

/** Receiving stock, writing off damage, or correcting a count. */
export function usePostStockMovement(tenantId: string | null) {
  const invalidate = useProductInvalidator(tenantId);
  return useMutation({
    mutationFn: (input: StockMovementInput) => postStockMovement(input),
    onSuccess: invalidate,
  });
}
