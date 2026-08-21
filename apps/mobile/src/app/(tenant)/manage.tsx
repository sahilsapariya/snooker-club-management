import { Coffee, Lock, Package, Plus, Tag } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';

import {
  Badge,
  Button,
  Card,
  Divider,
  EmptyState,
  ListItem,
  LoadingState,
  MoneyValue,
  Screen,
  SectionHeader,
  Select,
  Text,
} from '@/components/ui';
import { useAppSession } from '@/features/auth';
import { EditPricingRuleSheet, usePricingRules } from '@/features/pricing';
import { EditProductSheet, useProducts, type ProductWithCategory } from '@/features/products';
import { useTableTypes } from '@/features/tables';
import type { CurrencyConfig } from '@/lib/format';
import { useTheme } from '@/theme';

type Tab = 'products' | 'pricing';

/**
 * Club configuration, for owners.
 *
 * A receptionist reaching this screen sees a locked state rather than a blank
 * one, because being told "you cannot do this" is more useful than an empty
 * list. That message is courtesy, not security - RLS rejects every write here
 * from a receptionist regardless of what the UI shows.
 */
export default function ManageScreen() {
  const theme = useTheme();
  const session = useAppSession();

  const tenant = session.status === 'tenant-user' ? session.tenant : null;
  const tenantId = tenant?.id ?? null;
  const isOwner = session.status === 'tenant-user' && session.role === 'OWNER';

  const [tab, setTab] = useState<Tab>('products');
  const [editingProduct, setEditingProduct] = useState<ProductWithCategory | null>(null);
  const [newProduct, setNewProduct] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [newRule, setNewRule] = useState(false);

  const products = useProducts(isOwner ? tenantId : null);
  const rules = usePricingRules(isOwner ? tenantId : null);
  const tableTypes = useTableTypes(isOwner ? tenantId : null);

  const currency: CurrencyConfig = useMemo(
    () => ({
      code: tenant?.currency_code ?? 'INR',
      minorUnits: tenant?.currency_minor_units ?? 2,
    }),
    [tenant?.currency_code, tenant?.currency_minor_units],
  );

  if (session.status !== 'tenant-user') {
    return (
      <Screen>
        <LoadingState />
      </Screen>
    );
  }

  if (!isOwner) {
    return (
      <Screen testID="manage-screen">
        <EmptyState
          icon={Lock}
          title="Owners only"
          description="Products and pricing are managed by the club owner. Ask them to make changes for you."
        />
      </Screen>
    );
  }

  const editingRule = (rules.data ?? []).find((r) => r.id === editingRuleId) ?? null;

  return (
    <Screen padded={false} testID="manage-screen">
      <View style={{ padding: theme.spacing.lg, gap: theme.spacing.lg }}>
        <View style={{ gap: theme.spacing.xs }}>
          <Text variant="caption" color="textMuted">
            Owner
          </Text>
          <Text variant="displayMd">Manage club</Text>
        </View>

        <Select
          value={tab}
          onChange={setTab}
          options={[
            { value: 'products', label: 'Products' },
            { value: 'pricing', label: 'Pricing' },
          ]}
        />
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: theme.spacing['5xl'],
          gap: theme.spacing.lg,
        }}
        refreshControl={
          <RefreshControl
            refreshing={products.isRefetching || rules.isRefetching}
            onRefresh={() => {
              void products.refetch();
              void rules.refetch();
            }}
            tintColor={theme.colors.primary}
          />
        }
      >
        {tab === 'products' ? (
          <View>
            <SectionHeader
              title="Catalogue"
              subtitle="What reception can sell during a session"
              action={{ label: 'Add', onPress: () => setNewProduct(true) }}
            />
            {products.isPending ? (
              <LoadingState />
            ) : (products.data ?? []).length === 0 ? (
              <EmptyState
                icon={Coffee}
                title="No products yet"
                description="Add drinks and snacks so reception can put them on a bill."
                actionLabel="Add a product"
                onAction={() => setNewProduct(true)}
              />
            ) : (
              <Card style={{ gap: theme.spacing.xs }}>
                {(products.data ?? []).map((product, index) => (
                  <View key={product.id}>
                    {index > 0 ? <Divider /> : null}
                    <ListItem
                      title={product.name}
                      subtitle={`${product.category?.name ?? 'Uncategorised'} · ${product.stock_quantity} ${product.unit}`}
                      icon={Package}
                      showChevron
                      onPress={() => setEditingProduct(product)}
                      trailing={
                        <View style={{ alignItems: 'flex-end', gap: 2 }}>
                          <MoneyValue
                            amountMinor={product.selling_price_minor}
                            currency={currency}
                            variant="titleSm"
                          />
                          {product.track_inventory &&
                          product.stock_quantity <= product.low_stock_threshold ? (
                            <Badge label="Low" tone="warning" />
                          ) : null}
                        </View>
                      }
                    />
                  </View>
                ))}
              </Card>
            )}
          </View>
        ) : (
          <View>
            <SectionHeader
              title="Pricing rules"
              subtitle="Changing these never reprices a session already running"
              action={{ label: 'Add', onPress: () => setNewRule(true) }}
            />
            {rules.isPending ? (
              <LoadingState />
            ) : (rules.data ?? []).length === 0 ? (
              <EmptyState
                icon={Tag}
                title="No pricing rules"
                description="Add a rate so sessions can be billed."
                actionLabel="Add a rule"
                onAction={() => setNewRule(true)}
              />
            ) : (
              <Card style={{ gap: theme.spacing.xs }}>
                {(rules.data ?? []).map((rule, index) => (
                  <View key={rule.id}>
                    {index > 0 ? <Divider /> : null}
                    <ListItem
                      title={rule.name}
                      subtitle={`${rule.table_type?.name ?? 'All tables'} · ${rule.pricing_mode.replace(/_/g, ' ').toLowerCase()}`}
                      icon={Tag}
                      showChevron
                      onPress={() => setEditingRuleId(rule.id)}
                      disabled={!rule.is_active}
                      trailing={
                        <View style={{ alignItems: 'flex-end', gap: 2 }}>
                          <MoneyValue
                            amountMinor={rule.rate_minor}
                            currency={currency}
                            variant="titleSm"
                          />
                          {rule.is_default ? <Badge label="Default" tone="brand" /> : null}
                          {!rule.is_active ? <Badge label="Inactive" tone="neutral" /> : null}
                        </View>
                      }
                    />
                  </View>
                ))}
              </Card>
            )}

            <Button
              label="Add pricing rule"
              variant="outline"
              icon={Plus}
              fullWidth
              style={{ marginTop: theme.spacing.lg }}
              onPress={() => setNewRule(true)}
            />
          </View>
        )}
      </ScrollView>

      <EditProductSheet
        visible={newProduct || editingProduct !== null}
        onClose={() => {
          setNewProduct(false);
          setEditingProduct(null);
        }}
        product={editingProduct}
        tenantId={session.tenant.id}
        userId={session.profile.id}
        currency={currency}
      />

      <EditPricingRuleSheet
        visible={newRule || editingRule !== null}
        onClose={() => {
          setNewRule(false);
          setEditingRuleId(null);
        }}
        rule={editingRule}
        tenantId={session.tenant.id}
        currency={currency}
        tableTypes={tableTypes.data ?? []}
      />
    </Screen>
  );
}
