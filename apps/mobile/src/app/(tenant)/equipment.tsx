import { Package, Plus, Wrench } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';

import {
  Badge,
  Button,
  Card,
  Divider,
  EmptyState,
  EquipmentStatusBadge,
  ErrorState,
  Input,
  ListItem,
  LoadingState,
  MoneyInput,
  Screen,
  SectionHeader,
  Select,
  Sheet,
  Text,
  useToast,
} from '@/components/ui';
import { useAppSession } from '@/features/auth';
import {
  useCreateEquipment,
  useEquipment,
  useUpdateEquipment,
  type Equipment,
  type EquipmentCategory,
  type EquipmentStatus,
} from '@/features/equipment';
import { useManagedTables } from '@/features/tables';
import type { CurrencyConfig } from '@/lib/format';
import { useTheme } from '@/theme';

const CATEGORIES: readonly { value: EquipmentCategory; label: string }[] = [
  { value: 'CUE', label: 'Cues' },
  { value: 'REST_CUE', label: 'Rests' },
  { value: 'BALL_SET', label: 'Ball sets' },
  { value: 'CHALK', label: 'Chalk' },
  { value: 'GLOVE', label: 'Gloves' },
  { value: 'TABLE_ACCESSORY', label: 'Table accessories' },
  { value: 'FURNITURE', label: 'Furniture' },
  { value: 'OTHER', label: 'Other' },
];

/** Retiring is a disposal decision, so it is not offered alongside condition. */
const CONDITIONS: readonly { value: EquipmentStatus; label: string; hint: string }[] = [
  { value: 'AVAILABLE', label: 'Available', hint: 'On the rack and usable' },
  { value: 'IN_USE', label: 'In use', hint: 'Out on a table right now' },
  { value: 'NEEDS_REPAIR', label: 'Needs repair', hint: 'Usable, but book it in' },
  { value: 'DAMAGED', label: 'Damaged', hint: 'Not to be handed out' },
];

/**
 * What the club owns, and what state it is in.
 *
 * Unusually for a configuration screen, **any member can use most of it**. The
 * thing that actually happens with a cue is a receptionist picking it up
 * mid-shift and finding the tip gone; making them phone the owner to record
 * that is how the register stops matching the rack.
 *
 * So the screen has two levels of access, and the database enforces the line
 * rather than this file (migration 0025):
 *
 *   any member   report a change of condition, and note why
 *   the owner    add, price, assign to a table, retire, restore
 *
 * A receptionist tapping an owner-only control simply has the write refused.
 */
export default function EquipmentScreen() {
  const theme = useTheme();
  const session = useAppSession();

  const tenant = session.status === 'tenant-user' ? session.tenant : null;
  const tenantId = tenant?.id ?? null;
  const isOwner = session.status === 'tenant-user' && session.role === 'OWNER';

  const equipment = useEquipment(tenantId);
  const tables = useManagedTables(isOwner ? tenantId : null);
  const createItem = useCreateEquipment(tenantId);
  const updateItem = useUpdateEquipment(tenantId);
  const toast = useToast();

  const [editing, setEditing] = useState<Equipment | null>(null);
  const [creating, setCreating] = useState(false);

  const currency: CurrencyConfig = useMemo(
    () => ({
      code: tenant?.currency_code ?? 'INR',
      minorUnits: tenant?.currency_minor_units ?? 2,
    }),
    [tenant?.currency_code, tenant?.currency_minor_units],
  );

  const { grouped, retired, needingAttention } = useMemo(() => {
    const all = equipment.data ?? [];
    const live = all.filter((item) => item.status !== 'RETIRED');
    const byCategory = new Map<EquipmentCategory, Equipment[]>();

    for (const item of live) {
      const bucket = byCategory.get(item.category);
      if (bucket) bucket.push(item);
      else byCategory.set(item.category, [item]);
    }

    return {
      grouped: [...byCategory.entries()],
      retired: all.filter((item) => item.status === 'RETIRED'),
      needingAttention: live.filter(
        (item) => item.status === 'NEEDS_REPAIR' || item.status === 'DAMAGED',
      ),
    };
  }, [equipment.data]);

  if (session.status !== 'tenant-user') {
    return (
      <Screen>
        <LoadingState />
      </Screen>
    );
  }

  return (
    <Screen padded={false} testID="equipment-screen">
      <ScrollView
        contentContainerStyle={{
          padding: theme.spacing.lg,
          gap: theme.spacing.xl,
          paddingBottom: theme.spacing['5xl'],
        }}
        refreshControl={
          <RefreshControl
            refreshing={equipment.isRefetching}
            onRefresh={() => void equipment.refetch()}
          />
        }
      >
        {equipment.isError ? (
          <ErrorState error={equipment.error} onRetry={() => void equipment.refetch()} />
        ) : null}
        {equipment.isPending ? <LoadingState label="Loading equipment" /> : null}

        {needingAttention.length > 0 ? (
          <Card
            style={{ gap: theme.spacing.xs, borderWidth: 1, borderColor: theme.colors.warning }}
          >
            <View style={{ flexDirection: 'row', gap: theme.spacing.sm, alignItems: 'center' }}>
              <Wrench color={theme.colors.warning} size={18} />
              <Text variant="titleSm">
                {needingAttention.length}{' '}
                {needingAttention.length === 1 ? 'item needs' : 'items need'} attention
              </Text>
            </View>
            <Text variant="caption" color="textMuted">
              {needingAttention.map((item) => item.name).join(', ')}
            </Text>
          </Card>
        ) : null}

        {!equipment.isPending && (equipment.data ?? []).length === 0 ? (
          <EmptyState
            icon={Package}
            title="Nothing on the register yet"
            description={
              isOwner
                ? "Add the club's cues, rests and ball sets so their condition can be tracked."
                : 'The club owner has not added any equipment yet.'
            }
          />
        ) : null}

        {grouped.map(([category, items]) => (
          <View key={category}>
            <SectionHeader
              title={CATEGORIES.find((c) => c.value === category)?.label ?? 'Other'}
              subtitle={`${items.length} ${items.length === 1 ? 'item' : 'items'}`}
              {...(isOwner && grouped[0]?.[0] === category
                ? { action: { label: 'Add item', onPress: () => setCreating(true) } }
                : {})}
            />
            <Card style={{ gap: theme.spacing.xs }}>
              {items.map((item, index) => (
                <View key={item.id}>
                  {index > 0 ? <Divider /> : null}
                  <ListItem
                    title={item.name}
                    {...subtitleOf([item.asset_code, item.notes].filter(Boolean).join(' · '))}
                    icon={Package}
                    showChevron
                    onPress={() => setEditing(item)}
                    testID={`equipment-row-${item.id}`}
                    trailing={<EquipmentStatusBadge status={item.status} />}
                  />
                </View>
              ))}
            </Card>
          </View>
        ))}

        {retired.length > 0 ? (
          <View>
            <SectionHeader
              title="Retired"
              subtitle="Kept on the register so past repairs and costs still make sense"
            />
            <Card style={{ gap: theme.spacing.xs }}>
              {retired.map((item, index) => (
                <View key={item.id}>
                  {index > 0 ? <Divider /> : null}
                  <ListItem
                    title={item.name}
                    {...subtitleOf(item.notes)}
                    icon={Package}
                    {...(isOwner ? { showChevron: true, onPress: () => setEditing(item) } : {})}
                    trailing={<Badge label="Retired" tone="neutral" />}
                  />
                </View>
              ))}
            </Card>
          </View>
        ) : null}

        {isOwner && (equipment.data ?? []).length > 0 ? (
          <Button
            label="Add equipment"
            icon={Plus}
            variant="outline"
            fullWidth
            onPress={() => setCreating(true)}
          />
        ) : null}

        {isOwner ? null : (
          <Text variant="caption" color="textMuted">
            You can report a change of condition on anything here. Adding, pricing and retiring
            equipment is the club owner&apos;s.
          </Text>
        )}
      </ScrollView>

      <EquipmentSheet
        key={creating ? 'new' : (editing?.id ?? 'none')}
        visible={creating || editing !== null}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        item={creating ? null : editing}
        isOwner={isOwner}
        currency={currency}
        tables={(tables.data ?? [])
          .filter((table) => table.is_active)
          .map((table) => ({ value: table.id, label: table.name }))}
        saving={createItem.isPending || updateItem.isPending}
        onSave={(values) => {
          if (creating) {
            createItem.mutate(values, {
              onSuccess: () => {
                toast.success(`${values.name} added`);
                setCreating(false);
              },
              onError: (error) => toast.error(error, 'Could not add that.'),
            });
            return;
          }
          if (!editing) return;
          updateItem.mutate(
            { equipmentId: editing.id, ...values },
            {
              onSuccess: () => {
                toast.success(`${values.name} saved`);
                setEditing(null);
              },
              onError: (error) => toast.error(error, 'Could not save that.'),
            },
          );
        }}
        onSetCondition={(status) => {
          if (!editing) return;
          updateItem.mutate(
            { equipmentId: editing.id, status },
            {
              onSuccess: () => {
                toast.success(`${editing.name} updated`);
                setEditing(null);
              },
              onError: (error) => toast.error(error, 'Could not change that.'),
            },
          );
        }}
        onToggleRetired={() => {
          if (!editing) return;
          const retiring = editing.status !== 'RETIRED';
          updateItem.mutate(
            { equipmentId: editing.id, status: retiring ? 'RETIRED' : 'AVAILABLE' },
            {
              onSuccess: () => {
                toast.success(retiring ? `${editing.name} retired` : `${editing.name} is back`);
                setEditing(null);
              },
              onError: (error) => toast.error(error, 'Could not change that.'),
            },
          );
        }}
      />
    </Screen>
  );
}

/** `exactOptionalPropertyTypes` means an absent subtitle must be absent, not undefined. */
function subtitleOf(value: string | null): { subtitle?: string } {
  return value && value.length > 0 ? { subtitle: value } : {};
}

interface EquipmentValues {
  readonly category: EquipmentCategory;
  readonly name: string;
  readonly assetCode: string | null;
  readonly assignedTableId: string | null;
  readonly purchasePriceMinor: number | null;
  readonly purchasedAt: string | null;
  readonly notes: string | null;
}

function EquipmentSheet({
  visible,
  onClose,
  item,
  isOwner,
  currency,
  tables,
  saving,
  onSave,
  onSetCondition,
  onToggleRetired,
}: {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly item: Equipment | null;
  readonly isOwner: boolean;
  readonly currency: CurrencyConfig;
  readonly tables: readonly { value: string; label: string }[];
  readonly saving: boolean;
  readonly onSave: (values: EquipmentValues) => void;
  readonly onSetCondition: (status: EquipmentStatus) => void;
  readonly onToggleRetired: () => void;
}) {
  const theme = useTheme();

  const [category, setCategory] = useState<EquipmentCategory>(item?.category ?? 'CUE');
  const [name, setName] = useState(item?.name ?? '');
  const [assetCode, setAssetCode] = useState(item?.asset_code ?? '');
  const [tableId, setTableId] = useState<string | null>(item?.assigned_table_id ?? null);
  const [price, setPrice] = useState(item?.purchase_price_minor ?? 0);
  const [notes, setNotes] = useState(item?.notes ?? '');

  const trimmed = name.trim();
  const canSave = trimmed.length > 0;
  const isRetired = item?.status === 'RETIRED';

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={item ? item.name : 'Add equipment'}
      subtitle={item ? 'Condition, and what it is' : 'It joins the register straight away'}
      testID="equipment-sheet"
    >
      <View style={{ gap: theme.spacing.lg }}>
        {/* Condition first: it is the field anybody can change, and the one
            most often being changed. */}
        {item && !isRetired ? (
          <View style={{ gap: theme.spacing.sm }}>
            <Select
              label="Condition"
              value={item.status}
              onChange={onSetCondition}
              options={[...CONDITIONS]}
              testID="equipment-condition"
            />
            <Text variant="caption" color="textMuted">
              Anyone on shift can change this. It saves as soon as you pick.
            </Text>
          </View>
        ) : null}

        {isOwner ? (
          <>
            {item ? <Divider /> : null}

            <Input
              label="Name"
              value={name}
              onChangeText={setName}
              placeholder="House Cue A"
              autoCapitalize="words"
              testID="equipment-name"
            />

            <Select
              label="Category"
              value={category}
              onChange={setCategory}
              options={[...CATEGORIES]}
            />

            <Input
              label="Asset code"
              value={assetCode}
              onChangeText={setAssetCode}
              placeholder="Optional"
              autoCapitalize="characters"
            />

            {tables.length > 0 ? (
              <Select
                label="Assigned to"
                value={tableId}
                onChange={setTableId}
                options={[{ value: '', label: 'Not assigned' }, ...tables]}
              />
            ) : null}

            <MoneyInput
              label="What it cost"
              value={price}
              onChange={setPrice}
              currency={currency}
              hint="Optional. Used for the club's own records, not for billing."
            />

            <Input label="Notes" value={notes} onChangeText={setNotes} multiline />

            <Button
              label={item ? 'Save details' : 'Add to the register'}
              fullWidth
              disabled={!canSave}
              loading={saving}
              testID="save-equipment"
              onPress={() =>
                onSave({
                  category,
                  name: trimmed,
                  assetCode: assetCode.trim() === '' ? null : assetCode.trim(),
                  assignedTableId: tableId === '' ? null : tableId,
                  purchasePriceMinor: price > 0 ? price : null,
                  purchasedAt: item?.purchased_at ?? null,
                  notes: notes.trim() === '' ? null : notes.trim(),
                })
              }
            />

            {item ? (
              <>
                <Divider />
                <Button
                  label={isRetired ? 'Put back on the rack' : 'Retire this item'}
                  variant={isRetired ? 'primary' : 'outline'}
                  fullWidth
                  loading={saving}
                  onPress={onToggleRetired}
                  testID="toggle-retired"
                />
                <Text variant="caption" color="textMuted">
                  Equipment is never deleted. A retired item keeps its history and its cost, and
                  stops being assigned to a table.
                </Text>
              </>
            ) : null}
          </>
        ) : (
          <View style={{ gap: theme.spacing.sm }}>
            <Input
              label="Note"
              value={notes}
              onChangeText={setNotes}
              placeholder="What is wrong with it?"
              multiline
            />
            <Button
              label="Save note"
              variant="outline"
              fullWidth
              loading={saving}
              onPress={() =>
                onSave({
                  category: item?.category ?? 'OTHER',
                  name: item?.name ?? '',
                  assetCode: item?.asset_code ?? null,
                  assignedTableId: item?.assigned_table_id ?? null,
                  purchasePriceMinor: item?.purchase_price_minor ?? null,
                  purchasedAt: item?.purchased_at ?? null,
                  notes: notes.trim() === '' ? null : notes.trim(),
                })
              }
            />
            <Text variant="caption" color="textMuted">
              Adding, pricing and retiring equipment is the club owner&apos;s.
            </Text>
          </View>
        )}
      </View>
    </Sheet>
  );
}
