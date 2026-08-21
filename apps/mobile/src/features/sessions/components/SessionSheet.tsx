import { Coffee, Trash2 } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import {
  Badge,
  Button,
  Divider,
  IconButton,
  ListItem,
  MoneyValue,
  QuantityStepper,
  SectionHeader,
  Select,
  SessionStatusBadge,
  Sheet,
  Text,
  Timer,
  useToast,
} from '@/components/ui';
import { calculateSessionCharge, type BillingSettings } from '@/features/billing';
import { useProducts } from '@/features/products';
import { formatDuration, type CurrencyConfig } from '@/lib/format';
import { useTheme } from '@/theme';
import type { Database } from '@/types/database.types';

import { pricingRuleFromSnapshot } from '../api/sessions.api';
import type { SessionWithContext } from '../api/sessions.api';
import {
  useAddSessionItem,
  useCancelSession,
  useCloseSession,
  useRemoveSessionItem,
} from '../hooks/use-sessions';

type PaymentMethod = Database['public']['Enums']['payment_method'];

const PAYMENT_METHODS: readonly { value: PaymentMethod; label: string }[] = [
  { value: 'CASH', label: 'Cash' },
  { value: 'UPI', label: 'UPI' },
  { value: 'CARD', label: 'Card' },
  { value: 'BANK_TRANSFER', label: 'Transfer' },
];

export interface SessionSheetProps {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly session: SessionWithContext | null;
  readonly tenantId: string;
  readonly userId: string;
  readonly currency: CurrencyConfig;
  readonly billingSettings: BillingSettings | null;
}

/**
 * The running-session workspace: live clock, drinks, and the close-and-pay flow.
 *
 * The bill is recomputed on every render from the recorded start time, so what
 * staff see while the session runs is exactly what the engine will charge when
 * they close it. There is no separate "preview" path that could drift from the
 * real one.
 */
export function SessionSheet({
  visible,
  onClose,
  session,
  tenantId,
  userId,
  currency,
  billingSettings,
}: SessionSheetProps) {
  const theme = useTheme();
  const toast = useToast();

  const { data: products } = useProducts(visible ? tenantId : null);
  const addItem = useAddSessionItem(tenantId);
  const removeItem = useRemoveSessionItem(tenantId, session?.id ?? null);
  const closeSession = useCloseSession(tenantId);
  const cancelSession = useCancelSession(tenantId);

  const [showCatalogue, setShowCatalogue] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CASH');

  // `line_total_minor` is a generated column, so PostgREST types it nullable
  // even though the database always computes it.
  const itemsTotalMinor = useMemo(
    () =>
      (session?.session_items ?? []).reduce((sum, item) => sum + (item.line_total_minor ?? 0), 0),
    [session?.session_items],
  );

  // Recomputed each render; the Timer below re-renders every second, so the
  // running total stays live without a second timer of its own.
  const charge = useMemo(() => {
    if (!session || !billingSettings) return null;
    // Priced from the rule captured when the session started, never the
    // current one - see pricingRuleFromSnapshot.
    return calculateSessionCharge(
      {
        startedAt: session.started_at,
        endedAt: session.ended_at,
        plannedDurationMinutes: session.planned_duration_minutes,
        framesPlayed: session.frames_played,
      },
      billingSettings,
      pricingRuleFromSnapshot(session.pricing_snapshot),
    );
  }, [session, billingSettings]);

  if (!session) return null;

  const tableChargeMinor = charge?.tableChargeMinor ?? 0;
  const totalMinor = tableChargeMinor + itemsTotalMinor;

  function handleAddProduct(productId: string): void {
    if (!session) return;
    addItem.mutate(
      { tenantId, sessionId: session.id, productId, quantity: 1, addedBy: userId },
      { onError: (error) => toast.error(error, 'Could not add that item.') },
    );
  }

  function handleClose(): void {
    if (!session || !charge) return;

    closeSession.mutate(
      {
        sessionId: session.id,
        endedBy: userId,
        charge,
        discountMinor: 0,
        payment: {
          status: 'PAID',
          method: paymentMethod,
          paidAmountMinor: totalMinor,
        },
        notes: null,
      },
      {
        onSuccess: () => {
          toast.success(`${session.club_table?.name ?? 'Table'} closed and paid`);
          onClose();
        },
        onError: (error) => toast.error(error, 'Could not close the session.'),
      },
    );
  }

  function handleCancel(): void {
    if (!session) return;
    cancelSession.mutate(
      { sessionId: session.id, endedBy: userId, reason: 'Cancelled by staff' },
      {
        onSuccess: () => {
          toast.show('Session cancelled', 'info');
          onClose();
        },
        onError: (error) => toast.error(error, 'Could not cancel the session.'),
      },
    );
  }

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={session.club_table?.name ?? 'Session'}
      subtitle={session.customer_name ?? 'Walk-in'}
      testID="session-sheet"
      footer={
        <View style={{ gap: theme.spacing.sm }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text variant="titleMd" style={{ flex: 1 }}>
              Total
            </Text>
            <MoneyValue amountMinor={totalMinor} currency={currency} variant="titleLg" />
          </View>
          <Button
            label={`Close & take ${PAYMENT_METHODS.find((m) => m.value === paymentMethod)?.label.toLowerCase() ?? 'payment'}`}
            size="lg"
            fullWidth
            loading={closeSession.isPending}
            onPress={handleClose}
            testID="close-session"
          />
        </View>
      }
    >
      <View style={{ gap: theme.spacing.xl }}>
        {/* ---- Live clock ---------------------------------------------- */}
        <View
          style={{
            backgroundColor:
              session.status === 'TIME_COMPLETED'
                ? theme.colors.warningContainer
                : theme.colors.surfaceSunken,
            borderRadius: theme.radius.lg,
            padding: theme.spacing.lg,
            gap: theme.spacing.xs,
            alignItems: 'center',
          }}
        >
          <Timer
            startedAtIso={session.started_at}
            variant="titleLg"
            tone={session.status === 'TIME_COMPLETED' ? 'warning' : 'textPrimary'}
          />
          <View style={{ flexDirection: 'row', gap: theme.spacing.sm, alignItems: 'center' }}>
            <SessionStatusBadge status={session.status} />
            {session.planned_duration_minutes !== null ? (
              <Badge label={`Booked ${session.planned_duration_minutes}m`} tone="neutral" />
            ) : (
              <Badge label="Open ended" tone="neutral" />
            )}
          </View>
          {session.status === 'TIME_COMPLETED' ? (
            <Text variant="caption" color="textMuted" align="center">
              The booked time has passed. The session is still running until you close it.
            </Text>
          ) : null}
        </View>

        {/* ---- The bill ------------------------------------------------ */}
        <View>
          <SectionHeader title="Bill" subtitle="Recalculated live from the recorded start time" />
          <View style={{ gap: theme.spacing.sm }}>
            {(charge?.lines ?? []).map((line) => (
              <View key={line.label} style={{ flexDirection: 'row', alignItems: 'center' }}>
                <View style={{ flex: 1 }}>
                  <Text variant="bodySm">{line.label}</Text>
                  <Text variant="caption" color="textMuted">
                    {line.detail}
                  </Text>
                </View>
                <MoneyValue amountMinor={line.amountMinor} currency={currency} variant="body" />
              </View>
            ))}

            {session.session_items.length > 0 ? (
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text variant="bodySm" style={{ flex: 1 }}>
                  Food & drink
                </Text>
                <MoneyValue amountMinor={itemsTotalMinor} currency={currency} variant="body" />
              </View>
            ) : null}

            {charge === null ? (
              <Text variant="caption" color="warning">
                No billing configuration found for this club, so table time cannot be priced yet.
              </Text>
            ) : null}
          </View>

          {(charge?.notes.length ?? 0) > 0 ? (
            <View style={{ marginTop: theme.spacing.sm, gap: 2 }}>
              {charge?.notes.map((note) => (
                <Text key={note} variant="caption" color="textMuted">
                  · {note}
                </Text>
              ))}
            </View>
          ) : null}

          <Text variant="caption" color="textMuted" style={{ marginTop: theme.spacing.sm }}>
            Actual time played: {formatDuration(charge?.actualSeconds ?? 0)} — recorded in full
            regardless of what is billed.
          </Text>
        </View>

        {/* ---- Items --------------------------------------------------- */}
        <View>
          <SectionHeader
            title="Food & drink"
            action={{
              label: showCatalogue ? 'Done' : 'Add item',
              onPress: () => setShowCatalogue((open) => !open),
            }}
          />

          {session.session_items.length === 0 && !showCatalogue ? (
            <Text variant="bodySm" color="textMuted">
              Nothing added yet.
            </Text>
          ) : null}

          {session.session_items.map((item) => (
            <View key={item.id}>
              <ListItem
                title={item.product_name_snapshot}
                subtitle={`${item.quantity} × ${(item.unit_price_minor / 100).toFixed(2)}`}
                icon={Coffee}
                trailing={
                  <View
                    style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}
                  >
                    <MoneyValue amountMinor={item.line_total_minor ?? 0} currency={currency} />
                    <IconButton
                      icon={Trash2}
                      tone="danger"
                      accessibilityLabel={`Remove ${item.product_name_snapshot}`}
                      onPress={() =>
                        removeItem.mutate(item.id, {
                          onError: (error) => toast.error(error, 'Could not remove that item.'),
                        })
                      }
                    />
                  </View>
                }
              />
              <Divider />
            </View>
          ))}

          {showCatalogue ? (
            <View style={{ marginTop: theme.spacing.sm }}>
              {(products ?? []).map((product) => (
                <ListItem
                  key={product.id}
                  title={product.name}
                  subtitle={`${product.category?.name ?? 'Other'} · ${product.stock_quantity} in stock`}
                  disabled={product.track_inventory && product.stock_quantity <= 0}
                  trailing={
                    <View
                      style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}
                    >
                      <MoneyValue amountMinor={product.selling_price_minor} currency={currency} />
                      <QuantityStepper
                        value={0}
                        min={0}
                        max={1}
                        label={product.name}
                        onChange={() => handleAddProduct(product.id)}
                      />
                    </View>
                  }
                />
              ))}
              {(products ?? []).length === 0 ? (
                <Text variant="bodySm" color="textMuted">
                  No products in the catalogue yet.
                </Text>
              ) : null}
            </View>
          ) : null}
        </View>

        {/* ---- Payment ------------------------------------------------- */}
        <Select
          label="Payment method"
          value={paymentMethod}
          onChange={setPaymentMethod}
          options={[...PAYMENT_METHODS]}
        />

        <Button
          label="Cancel this session"
          variant="ghost"
          onPress={handleCancel}
          loading={cancelSession.isPending}
          accessibilityHint="Ends the session without charging. Use only for a mistaken start."
        />
      </View>
    </Sheet>
  );
}
