export {
  fetchProducts,
  fetchProductCategories,
  fetchLowStockProducts,
  type Product,
  type ProductCategory,
  type ProductWithCategory,
  type LowStockProduct,
} from './api/products.api';
export { useProducts, useProductCategories, useLowStockProducts } from './hooks/use-products';
export {
  createProduct,
  updateProduct,
  setProductActive,
  postStockMovement,
  fetchStockHistory,
  type InventoryMovement,
  type UpsertProductInput,
  type StockMovementInput,
} from './api/product-mutations.api';
export {
  useCreateProduct,
  useUpdateProduct,
  useSetProductActive,
  usePostStockMovement,
} from './hooks/use-product-mutations';
export { EditProductSheet, type EditProductSheetProps } from './components/EditProductSheet';
