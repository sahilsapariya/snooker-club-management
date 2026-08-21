import { Lock, Plus, Table2 } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';

import {
  Badge,
  Button,
  Card,
  Divider,
  EmptyState,
  ErrorState,
  Input,
  ListItem,
  LoadingState,
  Screen,
  SectionHeader,
  Select,
  Sheet,
  Text,
  useToast,
} from '@/components/ui';
import { useAppSession } from '@/features/auth';
import {
  useCreateClubTable,
  useManagedTables,
  useTableTypes,
  useUpdateClubTable,
  type ClubTable,
} from '@/features/tables';
import { useTheme } from '@/theme';

/**
 * The physical inventory of the club: which tables exist, and which are in play.
 *
 * Owner-only, and enforced twice over. The screen shows a locked state to a
 * receptionist as a courtesy, but since migration 0015 every insert, update and
 * delete policy on `club_tables` requires `app.is_tenant_owner(tenant_id)` -
 * so a receptionist who reached this screen anyway would simply have their
 * writes refused by Postgres. A platform administrator is refused too: the
 * platform brands and suspends clubs, it does not arrange their furniture.
 *
 * Tables are retired, never deleted. `sessions` references `club_tables` with
 * `on delete no action`, so a table that has ever been played on cannot be
 * removed without erasing that history - and "we got rid of that table" almost
 * never means "pretend it never existed".
 */
export default function TablesSetupScreen() {
  const theme = useTheme();
  const toast = useToast();
  const session = useAppSession();

  const isOwner = session.status === 'tenant-user' && session.role === 'OWNER';
  const tenantId = session.status === 'tenant-user' ? session.tenant.id : null;
  const scopedTenantId = isOwner ? tenantId : null;

  const tables = useManagedTables(scopedTenantId);
  const tableTypes = useTableTypes(scopedTenantId);
  const createTable = useCreateClubTable(tenantId);
  const updateTable = useUpdateClubTable(tenantId);

  const [editing, setEditing] = useState<ClubTable | null>(null);
  const [creating, setCreating] = useState(false);

  const typeNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const type of tableTypes.data ?? []) map.set(type.id, type.name);
    return map;
  }, [tableTypes.data]);

  const { active, retired } = useMemo(() => {
    const all = tables.data ?? [];
    return {
      active: all.filter((table) => table.is_active),
      retired: all.filter((table) => !table.is_active),
    };
  }, [tables.data]);

  if (session.status !== 'tenant-user') {
    return (
      <Screen>
        <LoadingState />
      </Screen>
    );
  }

  if (!isOwner) {
    return (
      <Screen>
        <EmptyState
          icon={Lock}
          title="Owner only"
          description="Adding and retiring tables changes what the club can sell. Ask the club owner to make the change."
        />
      </Screen>
    );
  }

  return (
    <Screen padded={false} testID="tables-setup-screen">
      <ScrollView
        contentContainerStyle={{
          padding: theme.spacing.lg,
          gap: theme.spacing.xl,
          paddingBottom: theme.spacing['5xl'],
        }}
        refreshControl={
          <RefreshControl
            refreshing={tables.isRefetching}
            onRefresh={() => void tables.refetch()}
          />
        }
      >
        {tables.isError ? (
          <ErrorState error={tables.error} onRetry={() => void tables.refetch()} />
        ) : null}
        {tables.isPending ? <LoadingState label="Loading tables" /> : null}

        <View>
          <SectionHeader
            title="In play"
            subtitle={`${active.length} of ${(tables.data ?? []).length} tables`}
            action={{ label: 'Add table', onPress: () => setCreating(true) }}
          />

          {active.length === 0 && !tables.isPending ? (
            <EmptyState
              icon={Table2}
              title="No tables yet"
              description="Add the club's tables so staff can start sessions on them."
            />
          ) : (
            <Card style={{ gap: theme.spacing.xs }}>
              {active.map((table, index) => (
                <View key={table.id}>
                  {index > 0 ? <Divider /> : null}
                  <ListItem
                    title={table.name}
                    subtitle={[
                      typeNames.get(table.table_type_id) ?? 'Table',
                      table.table_number === null ? null : `No. ${table.table_number}`,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                    icon={Table2}
                    showChevron
                    onPress={() => setEditing(table)}
                    testID={`table-row-${table.id}`}
                  />
                </View>
              ))}
            </Card>
          )}
        </View>

        {retired.length > 0 ? (
          <View>
            <SectionHeader
              title="Out of service"
              subtitle="Kept so past sessions still make sense. Bring one back at any time."
            />
            <Card style={{ gap: theme.spacing.xs }}>
              {retired.map((table, index) => (
                <View key={table.id}>
                  {index > 0 ? <Divider /> : null}
                  <ListItem
                    title={table.name}
                    subtitle={typeNames.get(table.table_type_id) ?? 'Table'}
                    icon={Table2}
                    trailing={<Badge label="Retired" tone="neutral" />}
                    showChevron
                    onPress={() => setEditing(table)}
                  />
                </View>
              ))}
            </Card>
          </View>
        ) : null}
      </ScrollView>

      <TableSheet
        visible={creating}
        onClose={() => setCreating(false)}
        table={null}
        tableTypes={(tableTypes.data ?? []).map((type) => ({ value: type.id, label: type.name }))}
        nextSortOrder={(tables.data ?? []).length}
        saving={createTable.isPending}
        onSave={(values) =>
          createTable.mutate(values, {
            onSuccess: () => {
              toast.success(`${values.name} added`);
              setCreating(false);
            },
            onError: (error) => toast.error(error, 'Could not add that table.'),
          })
        }
      />

      <TableSheet
        visible={editing !== null}
        onClose={() => setEditing(null)}
        table={editing}
        tableTypes={(tableTypes.data ?? []).map((type) => ({ value: type.id, label: type.name }))}
        nextSortOrder={editing?.sort_order ?? 0}
        saving={updateTable.isPending}
        onSave={(values) => {
          if (!editing) return;
          updateTable.mutate(
            { tableId: editing.id, ...values },
            {
              onSuccess: () => {
                toast.success(`${values.name} saved`);
                setEditing(null);
              },
              onError: (error) => toast.error(error, 'Could not save that table.'),
            },
          );
        }}
        onToggleActive={() => {
          if (!editing) return;
          updateTable.mutate(
            { tableId: editing.id, isActive: !editing.is_active },
            {
              onSuccess: () => {
                toast.success(
                  editing.is_active
                    ? `${editing.name} taken out of service`
                    : `${editing.name} is back in play`,
                );
                setEditing(null);
              },
              onError: (error) => toast.error(error, 'Could not change that table.'),
            },
          );
        }}
      />
    </Screen>
  );
}

interface TableValues {
  readonly name: string;
  readonly tableTypeId: string;
  readonly tableNumber: number | null;
  readonly sortOrder: number;
  readonly notes: string | null;
}

function TableSheet({
  visible,
  onClose,
  table,
  tableTypes,
  nextSortOrder,
  saving,
  onSave,
  onToggleActive,
}: {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly table: ClubTable | null;
  readonly tableTypes: readonly { value: string; label: string }[];
  readonly nextSortOrder: number;
  readonly saving: boolean;
  readonly onSave: (values: TableValues) => void;
  readonly onToggleActive?: () => void;
}) {
  const theme = useTheme();

  // Keyed remount rather than a synchronising effect: the sheet is either
  // showing a specific table or a blank form, and a key change is the simplest
  // honest way to say "this is a different form now".
  return (
    <Sheet
      key={table?.id ?? 'new'}
      visible={visible}
      onClose={onClose}
      title={table ? table.name : 'Add a table'}
      subtitle={
        table ? 'Change how this table appears to staff' : 'It appears on the floor at once'
      }
      testID="table-sheet"
    >
      <TableForm
        table={table}
        tableTypes={tableTypes}
        nextSortOrder={nextSortOrder}
        saving={saving}
        onSave={onSave}
        {...(onToggleActive ? { onToggleActive } : {})}
        theme={theme}
      />
    </Sheet>
  );
}

function TableForm({
  table,
  tableTypes,
  nextSortOrder,
  saving,
  onSave,
  onToggleActive,
  theme,
}: {
  readonly table: ClubTable | null;
  readonly tableTypes: readonly { value: string; label: string }[];
  readonly nextSortOrder: number;
  readonly saving: boolean;
  readonly onSave: (values: TableValues) => void;
  readonly onToggleActive?: () => void;
  readonly theme: ReturnType<typeof useTheme>;
}) {
  const [name, setName] = useState(table?.name ?? '');
  const [typeId, setTypeId] = useState<string | null>(
    table?.table_type_id ?? tableTypes[0]?.value ?? null,
  );
  const [number, setNumber] = useState(table?.table_number?.toString() ?? '');
  const [notes, setNotes] = useState(table?.notes ?? '');

  const trimmed = name.trim();
  const parsedNumber = number.trim() === '' ? null : Number.parseInt(number.trim(), 10);
  const numberInvalid = parsedNumber !== null && (Number.isNaN(parsedNumber) || parsedNumber < 1);
  const canSave = trimmed.length > 0 && typeId !== null && !numberInvalid;

  return (
    <View style={{ gap: theme.spacing.lg }}>
      <Input
        label="Name"
        value={name}
        onChangeText={setName}
        placeholder="Snooker 1"
        autoCapitalize="words"
        hint="What staff will see on the floor. Must be unique within the club."
        testID="table-name"
      />

      <Select
        label="Type"
        value={typeId}
        onChange={setTypeId}
        options={[...tableTypes]}
        testID="table-type"
      />

      <Input
        label="Table number"
        value={number}
        onChangeText={setNumber}
        placeholder="Optional"
        keyboardType="number-pad"
        error={numberInvalid ? 'Use a whole number above zero, or leave it blank.' : undefined}
      />

      <Input
        label="Notes"
        value={notes}
        onChangeText={setNotes}
        placeholder="Optional — cushion replaced, near the window…"
        multiline
      />

      <Button
        label={table ? 'Save changes' : 'Add table'}
        {...(table ? {} : { icon: Plus })}
        fullWidth
        disabled={!canSave}
        loading={saving}
        testID="save-table"
        onPress={() =>
          onSave({
            name: trimmed,
            tableTypeId: typeId as string,
            tableNumber: parsedNumber,
            sortOrder: table?.sort_order ?? nextSortOrder,
            notes: notes.trim() === '' ? null : notes.trim(),
          })
        }
      />

      {table && onToggleActive ? (
        <>
          <Divider />
          <Button
            label={table.is_active ? 'Take out of service' : 'Put back in play'}
            variant={table.is_active ? 'outline' : 'primary'}
            fullWidth
            loading={saving}
            onPress={onToggleActive}
            testID="toggle-table-active"
          />
          <Text variant="caption" color="textMuted">
            Tables are never deleted. Sessions already played on this table keep their history, and
            the table can be brought back at any time.
          </Text>
        </>
      ) : null}
    </View>
  );
}
