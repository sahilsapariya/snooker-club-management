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
