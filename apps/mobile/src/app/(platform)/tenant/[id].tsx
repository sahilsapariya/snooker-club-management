import { useLocalSearchParams } from 'expo-router';
import { ScrollView, View } from 'react-native';

import {
  Badge,
  Card,
  Divider,
  EmptyState,
  ErrorState,
  LoadingState,
  Screen,
  SectionHeader,
  Text,
} from '@/components/ui';
import { useTenant } from '@/features/platform/hooks/use-tenants';
import { buildTheme, THEME_PRESETS, useTheme } from '@/theme';

/**
 * One club, as the platform sees it.
 *
 * Read-only for now. The editing forms come next; what matters for the
 * foundation is that the write path is already decided and enforced: branding
 * changes go through `platform_update_tenant`, never through a table update,
 * because the `authenticated` role has no UPDATE privilege on `public.tenants`.
 */
export default function PlatformTenantDetailScreen() {
  const theme = useTheme();
  const params = useLocalSearchParams<{ id?: string }>();
  const tenantId = typeof params.id === 'string' ? params.id : null;

  const { data: tenant, isPending, isError, error, refetch } = useTenant(tenantId);

  if (isPending) return <LoadingState />;
  if (isError) return <ErrorState error={error} onRetry={() => void refetch()} />;
  if (!tenant) {
    return <EmptyState title="Club not found" description="It may have been archived." />;
  }

  // Preview the club's own palette without re-theming this admin screen.
  const clubTheme = buildTheme(
    {
      clubName: tenant.name,
      logoUrl: tenant.logo_url,
      primaryColor: tenant.primary_color,
      secondaryColor: tenant.secondary_color,
    },
    theme.scheme,
  );

  return (
    <Screen padded={false} edges={['left', 'right', 'bottom']}>
      <ScrollView
        contentContainerStyle={{
          padding: theme.spacing.lg,
          gap: theme.spacing.xl,
          paddingBottom: theme.spacing['4xl'],
        }}
      >
        <View style={{ gap: theme.spacing.xs }}>
          <Text variant="displayMd">{tenant.name}</Text>
          <Text variant="bodySm" color="textMuted">
            {tenant.slug}
          </Text>
          <View
            style={{ flexDirection: 'row', gap: theme.spacing.sm, marginTop: theme.spacing.xs }}
          >
            <Badge
              label={tenant.status}
              tone={tenant.status === 'ACTIVE' ? 'success' : 'warning'}
            />
            <Badge label={tenant.currency_code} tone="neutral" />
          </View>
        </View>

        <View>
          <SectionHeader title="Branding" subtitle="Platform controlled" />
          <Card style={{ gap: theme.spacing.md }}>
            <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
              <Swatch label="Primary" color={clubTheme.colors.primary} />
              <Swatch label="Secondary" color={clubTheme.colors.secondary} />
              <Swatch label="Container" color={clubTheme.colors.primaryContainer} />
              <Swatch label="Surface" color={clubTheme.colors.surface} />
            </View>
            <Divider />
            <Row label="Preset" value={tenant.theme_preset ?? 'custom'} />
            <Row label="Logo" value={tenant.logo_url ?? 'not set'} />
          </Card>
          <Text
            variant="caption"
            color="textMuted"
            style={{ marginTop: theme.spacing.sm, paddingHorizontal: theme.spacing.xs }}
          >
            Available presets: {THEME_PRESETS.map((preset) => preset.label).join(', ')}. A club user
            cannot change any of this; the database revokes the privilege rather than relying on
            this screen being hidden.
          </Text>
        </View>

        <View>
          <SectionHeader title="Configuration" />
          <Card style={{ gap: theme.spacing.sm }}>
            <Row label="Timezone" value={tenant.timezone} />
            <Divider />
            <Row label="Trading day starts" value={tenant.business_day_cutoff.slice(0, 5)} />
            <Divider />
            <Row label="Currency minor units" value={String(tenant.currency_minor_units)} />
          </Card>
        </View>

        <View>
          <SectionHeader title="Contact" />
          <Card style={{ gap: theme.spacing.sm }}>
            <Row label="Name" value={tenant.contact_name ?? '-'} />
            <Divider />
            <Row label="Email" value={tenant.contact_email ?? '-'} />
            <Divider />
            <Row label="Phone" value={tenant.contact_phone ?? '-'} />
            <Divider />
            <Row
              label="Address"
              value={
                [tenant.address_line1, tenant.city, tenant.state].filter(Boolean).join(', ') || '-'
              }
            />
          </Card>
        </View>
      </ScrollView>
    </Screen>
  );
}

function Swatch({ label, color }: { readonly label: string; readonly color: string }) {
  const theme = useTheme();
  return (
    <View style={{ alignItems: 'center', gap: theme.spacing.xs, flex: 1 }}>
      <View
        style={{
          width: '100%',
          height: 44,
          borderRadius: theme.radius.md,
          backgroundColor: color,
          borderWidth: 1,
          borderColor: theme.colors.border,
        }}
      />
      <Text variant="caption" color="textMuted">
        {label}
      </Text>
    </View>
  );
}

function Row({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <Text variant="bodySm" color="textSecondary" style={{ flex: 1 }}>
        {label}
      </Text>
      <Text variant="bodySm" numberOfLines={1} style={{ flexShrink: 1 }}>
        {value}
      </Text>
    </View>
  );
}
