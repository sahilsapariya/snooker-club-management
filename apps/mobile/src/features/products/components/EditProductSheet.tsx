import { useEffect, useState } from 'react';
import { View } from 'react-native';

import {
  Button,
  Divider,
  Input,
  MoneyInput,
  QuantityStepper,
  SectionHeader,
  Select,
  Sheet,
  Text,
  useToast,
} from '@/components/ui';
import type { CurrencyConfig } from '@/lib/format';
import { useTheme } from '@/theme';

import type { ProductWithCategory } from '../api/products.api';
import { useProductCategories } from '../hooks/use-products';
import {
  useCreateProduct,
  usePostStockMovement,
  useSetProductActive,
  useUpdateProduct,
} from '../hooks/use-product-mutations';

export interface EditProductSheetProps {
  readonly visible: boolean;
  readonly onClose: () => void;
  /** null creates a new product. */
  readonly product: ProductWithCategory | null;
  readonly tenantId: string;
  readonly userId: string;
  readonly currency: CurrencyConfig;
}

/**
 * Create or edit a product, and adjust its stock.
 *
 * Stock is not an editable field here. It is a projection of the inventory
 * ledger, so changing it means posting a movement - which leaves a record of
 * who changed what and why. Letting an owner type over the number would destroy
 * the audit trail the ledger exists to provide.
 */
export function EditProductSheet({
  visible,
  onClose,
  product,
  tenantId,
  userId,
  currency,
}: EditProductSheetProps) {
  const theme = useTheme();
  const toast = useToast();
  const { data: categories } = useProductCategories(visible ? tenantId : null);

  const createProduct = useCreateProduct(tenantId);
  const updateProduct = useUpdateProduct(tenantId);
  const setActive = useSetProductActive(tenantId);
  const postMovement = usePostStockMovement(tenantId);

  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [sellingPriceMinor, setSellingPriceMinor] = useState(0);
  const [costPriceMinor, setCostPriceMinor] = useState(0);
  const [lowStockThreshold, setLowStockThreshold] = useState(0);
  const [stockDelta, setStockDelta] = useState(0);

  useEffect(() => {
    if (!visible) return;
    setName(product?.name ?? '');
    setCategoryId(product?.category_id ?? null);
    setSellingPriceMinor(product?.selling_price_minor ?? 0);
    setCostPriceMinor(product?.cost_price_minor ?? 0);
    setLowStockThreshold(Number(product?.low_stock_threshold ?? 0));
    setStockDelta(0);
  }, [visible, product]);

  const isEditing = product !== null;
  const canSave = name.trim().length > 0 && sellingPriceMinor >= 0;
  const isBusy = createProduct.isPending || updateProduct.isPending;

  function handleSave(): void {
    const input = {
      tenantId,
      categoryId,
      name: name.trim(),
      sellingPriceMinor,
      costPriceMinor: costPriceMinor > 0 ? costPriceMinor : null,
      lowStockThreshold,
      unit: product?.unit ?? 'pcs',
      trackInventory: product?.track_inventory ?? true,
    };

    const onDone = {
      onSuccess: () => {
        toast.success(isEditing ? 'Product updated' : 'Product added');
        onClose();
      },
      onError: (error: unknown) => toast.error(error, 'Could not save the product.'),
    };

    if (isEditing && product) {
      updateProduct.mutate({ ...input, id: product.id }, onDone);
    } else {
      createProduct.mutate(input, onDone);
    }
  }

  function handleStockAdjustment(): void {
    if (!product || stockDelta === 0) return;
    postMovement.mutate(
      {
        tenantId,
        productId: product.id,
        movementType: stockDelta > 0 ? 'PURCHASE' : 'ADJUSTMENT',
        quantityDelta: stockDelta,
        unitCostMinor: stockDelta > 0 && costPriceMinor > 0 ? costPriceMinor : null,
        note: stockDelta > 0 ? 'Stock received' : 'Manual adjustment',
        createdBy: userId,
      },
      {
        onSuccess: () => {
          toast.success(`Stock ${stockDelta > 0 ? 'received' : 'adjusted'}`);
          setStockDelta(0);
        },
        onError: (error) => toast.error(error, 'Could not adjust the stock.'),
      },
    );
  }

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={isEditing ? 'Edit product' : 'Add product'}
      {...(isEditing && product
        ? { subtitle: `${product.stock_quantity} ${product.unit} in stock` }
        : {})}
      testID="edit-product-sheet"
      footer={
        <Button
          label={isEditing ? 'Save changes' : 'Add product'}
          size="lg"
          fullWidth
          disabled={!canSave}
          loading={isBusy}
          onPress={handleSave}
          testID="save-product"
        />
      }
    >
      <View style={{ gap: theme.spacing.xl }}>
        <Input
          label="Name"
          value={name}
          onChangeText={setName}
          placeholder="Mineral Water 1L"
          autoCapitalize="words"
        />

        <Select
          label="Category"
          value={categoryId}
          onChange={setCategoryId}
          options={(categories ?? []).map((c) => ({ value: c.id, label: c.name }))}
        />

        <MoneyInput
          label="Selling price"
          value={sellingPriceMinor}
          onChange={setSellingPriceMinor}
          currency={currency}
          testID="selling-price"
        />

        <MoneyInput
          label="Cost price (optional)"
          value={costPriceMinor}
          onChange={setCostPriceMinor}
          currency={currency}
          hint="Used for margin reporting later."
        />

        <View style={{ gap: theme.spacing.sm }}>
          <Text variant="label" color="textSecondary">
            Low stock alert below
          </Text>
          <QuantityStepper
            value={lowStockThreshold}
            onChange={setLowStockThreshold}
            min={0}
            max={999}
            label="Threshold"
          />
        </View>

        {isEditing && product ? (
          <>
            <Divider />
            <View style={{ gap: theme.spacing.md }}>
              <SectionHeader
                title="Adjust stock"
                subtitle="Posts a movement to the ledger rather than overwriting the count"
              />
              <QuantityStepper
                value={stockDelta}
                onChange={setStockDelta}
                min={-999}
                max={999}
                label="Change"
              />
              <Button
                label={
                  stockDelta > 0
                    ? `Receive ${stockDelta}`
                    : stockDelta < 0
                      ? `Write off ${Math.abs(stockDelta)}`
                      : 'Adjust stock'
                }
                variant="secondary"
                disabled={stockDelta === 0}
                loading={postMovement.isPending}
                onPress={handleStockAdjustment}
                fullWidth
              />
            </View>

            <Divider />
            <Button
              label={product.is_active ? 'Retire this product' : 'Restore this product'}
              variant={product.is_active ? 'ghost' : 'outline'}
              loading={setActive.isPending}
              onPress={() =>
                setActive.mutate(
                  { productId: product.id, isActive: !product.is_active },
                  {
                    onSuccess: () => {
                      toast.success(product.is_active ? 'Product retired' : 'Product restored');
                      onClose();
                    },
                    onError: (error) => toast.error(error, 'Could not update the product.'),
                  },
                )
              }
              accessibilityHint="Retired products stay on old bills but disappear from the till."
            />
          </>
        ) : null}
      </View>
    </Sheet>
  );
}
