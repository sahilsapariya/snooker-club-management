import { LogOut } from 'lucide-react-native';
import { ScrollView, View } from 'react-native';

import {
  Badge,
  Button,
  Card,
  Divider,
  LoadingState,
  Screen,
  SectionHeader,
  Text,
} from '@/components/ui';
import { useAppSession, useSignOut } from '@/features/auth';
import { formatMoney } from '@/lib/format';
import { useTheme } from '@/theme';

export default function SettingsScreen() {
  const theme = useTheme();
  const session = useAppSession();
  const signOut = useSignOut();

  if (session.status !== 'tenant-user') {
    return (
      <Screen>
        <LoadingState />
      </Screen>
    );
  }

  const { tenant, profile, role, billingSettings } = session;
  const currency = { code: tenant.currency_code, minorUnits: tenant.currency_minor_units };

  return (
    <Screen padded={false} testID="settings-screen">
      <ScrollView
        contentContainerStyle={{
          padding: theme.spacing.lg,
          gap: theme.spacing.xl,
          paddingBottom: theme.spacing['5xl'],
        }}
      >
        <View>
          <SectionHeader title="You" />
          <Card style={{ gap: theme.spacing.xs }}>
            <Text variant="titleMd">{profile.full_name ?? profile.email}</Text>
            <Text variant="bodySm" color="textMuted">
              {profile.email}
            </Text>
            <View style={{ marginTop: theme.spacing.xs }}>
              <Badge label={role === 'OWNER' ? 'Club owner' : 'Receptionist'} tone="brand" />
            </View>
          </Card>
        </View>

        <View>
          <SectionHeader
            title="Club"
            subtitle="Set by the platform administrator, not editable here"
          />
          <Card style={{ gap: theme.spacing.sm }}>
            <Row label="Name" value={tenant.name} />
            <Divider />
            <Row label="Identifier" value={tenant.slug} />
            <Divider />
            <Row label="Currency" value={tenant.currency_code} />
            <Divider />
            <Row label="Timezone" value={tenant.timezone} />
            <Divider />
            <Row label="Trading day starts" value={tenant.business_day_cutoff.slice(0, 5)} />
            <Divider />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
              <Text variant="bodySm" color="textSecondary" style={{ flex: 1 }}>
                Brand colour
              </Text>
              <View
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: theme.radius.sm,
                  backgroundColor: tenant.primary_color,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                }}
              />
              <Text variant="bodySm">{tenant.primary_color}</Text>
            </View>
          </Card>
          <Text
            variant="caption"
            color="textMuted"
            style={{ marginTop: theme.spacing.sm, paddingHorizontal: theme.spacing.xs }}
          >
            Club name, logo and colours are controlled by the platform administrator. The database
            refuses changes from club accounts, so these fields are read-only for everyone here.
          </Text>
        </View>

        {billingSettings ? (
          <View>
            <SectionHeader title="Billing rules" subtitle="Configured per club" />
            <Card style={{ gap: theme.spacing.sm }}>
              <Row
                label="Time calculation"
                value={humanise(billingSettings.time_calculation_mode)}
              />
              <Divider />
              <Row
                label="Billing block"
                value={`${billingSettings.billing_increment_minutes} min`}
              />
              <Divider />
              <Row label="Rounding" value={humanise(billingSettings.rounding_mode)} />
              <Divider />
              <Row label="Grace period" value={`${billingSettings.grace_period_minutes} min`} />
              <Divider />
              <Row label="Overtime" value={humanise(billingSettings.overtime_mode)} />
              <Divider />
              <Row
                label="Frame billing"
                value={
                  billingSettings.frame_billing_enabled
                    ? formatMoney(billingSettings.default_frame_price_minor ?? 0, { currency })
                    : 'Off'
                }
              />
            </Card>
            <Text
              variant="caption"
              color="textMuted"
              style={{ marginTop: theme.spacing.sm, paddingHorizontal: theme.spacing.xs }}
            >
              These rules decide what is charged. They never change what is recorded: the actual
              start, end and duration of a session are kept exactly as they happened.
            </Text>
          </View>
        ) : null}

        <Button
          label="Sign out"
          variant="outline"
          icon={LogOut}
          fullWidth
          onPress={() => void signOut()}
        />
      </ScrollView>
    </Screen>
  );
}

function Row({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <Text variant="bodySm" color="textSecondary" style={{ flex: 1 }}>
        {label}
      </Text>
      <Text variant="bodySm">{value}</Text>
    </View>
  );
}

function humanise(value: string): string {
  const lower = value.replace(/_/g, ' ').toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}
