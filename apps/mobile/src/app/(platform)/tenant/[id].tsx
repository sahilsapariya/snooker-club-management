import { useLocalSearchParams } from 'expo-router';
import { UserCog } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';

import {
  Badge,
  Button,
  Card,
  Divider,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  Screen,
  SectionHeader,
  Select,
  Sheet,
  Text,
  useToast,
} from '@/components/ui';
import {
  useAssignOwner,
  usePlatformClubs,
  useSetTenantStatus,
  useTenant,
  useUpdateTenantBranding,
  type Tenant,
  type TenantStatus,
} from '@/features/platform';
import { buildTheme, THEME_PRESETS, useTheme } from '@/theme';

const STATUSES: readonly { value: TenantStatus; label: string; hint: string }[] = [
  { value: 'TRIAL', label: 'Trial', hint: 'Fully usable, marked as evaluating' },
  { value: 'ACTIVE', label: 'Live', hint: 'A paying club' },
  { value: 'SUSPENDED', label: 'Suspended', hint: 'Staff are locked out immediately' },
  { value: 'ARCHIVED', label: 'Archived', hint: 'Closed for good. Records are kept.' },
];

/**
 * One club, as the platform sees and edits it.
 *
 * Every write here goes through an RPC. `public.tenants` has INSERT, UPDATE and
 * DELETE revoked from the `authenticated` role outright (migration 0011), so
 * branding is not "protected by this screen being hidden" - there is no
 * privilege for a club user to misuse in the first place, and each RPC
 * re-checks `app.is_platform_admin()` inside the database.
 *
 * Suspending is the sharpest control on this screen. `app.tenant_ids()` only
 * returns clubs in TRIAL or ACTIVE, so the moment a club is suspended every RLS
 * policy in the schema stops matching for its staff - mid-session, mid-request.
 */
export default function PlatformTenantDetailScreen() {
  const theme = useTheme();
  const toast = useToast();
  const params = useLocalSearchParams<{ id?: string }>();
  const tenantId = typeof params.id === 'string' ? params.id : null;

  const { data: tenant, isPending, isError, error, refetch } = useTenant(tenantId);
  const clubs = usePlatformClubs();
  const setStatus = useSetTenantStatus();
  const assignOwner = useAssignOwner();

  const [editingBranding, setEditingBranding] = useState(false);
  const [assigningOwner, setAssigningOwner] = useState(false);

  const ownerRow = useMemo(
    () => (clubs.data ?? []).find((club) => club.tenant_id === tenantId) ?? null,
    [clubs.data, tenantId],
  );

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
    <Screen padded={false} edges={['left', 'right', 'bottom']} testID="platform-tenant-screen">
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
          <SectionHeader
            title="Owner"
            subtitle="Who is billed for this club, and who may configure it"
          />
          <Card style={{ gap: theme.spacing.md }}>
            {ownerRow?.owner_user_id ? (
              <>
                <Row label="Name" value={ownerRow.owner_name ?? '-'} />
                <Divider />
                <Row label="Email" value={ownerRow.owner_email ?? '-'} />
              </>
            ) : (
              <Text variant="bodySm" color="warning">
                No owner. Nobody can configure this club or read its books.
              </Text>
            )}
            <Button
              label={ownerRow?.owner_user_id ? 'Change owner' : 'Assign an owner'}
              icon={UserCog}
              variant="outline"
              fullWidth
              onPress={() => setAssigningOwner(true)}
              testID="assign-owner"
            />
          </Card>
        </View>

        <View>
          <SectionHeader title="Status" subtitle="Suspending locks staff out immediately" />
          <Card>
            <Select
              label="Club status"
              value={tenant.status}
              onChange={(status) =>
                setStatus.mutate(
                  { tenantId: tenant.id, status },
                  {
                    onSuccess: () => toast.success(`${tenant.name} is now ${status.toLowerCase()}`),
                    onError: (err) => toast.error(err, 'Could not change the status.'),
                  },
                )
              }
              options={[...STATUSES]}
              testID="tenant-status"
            />
          </Card>
        </View>

        <View>
          <SectionHeader
            title="Branding"
            subtitle="Platform controlled — the club cannot change any of it"
            action={{ label: 'Edit', onPress: () => setEditingBranding(true) }}
          />
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
            <Divider />
            <Row label="Tables" value={String(ownerRow?.tables_count ?? 0)} />
            <Divider />
            <Row label="Reception staff" value={String(ownerRow?.staff_count ?? 0)} />
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

      <BrandingSheet
        key={tenant.id}
        visible={editingBranding}
        onClose={() => setEditingBranding(false)}
        tenant={tenant}
      />

      <Sheet
        visible={assigningOwner}
        onClose={() => setAssigningOwner(false)}
        title={ownerRow?.owner_user_id ? 'Change owner' : 'Assign an owner'}
        subtitle="They must already have a Club Desk account"
        testID="assign-owner-sheet"
      >
        <AssignOwnerForm
          hasOwner={Boolean(ownerRow?.owner_user_id)}
          saving={assignOwner.isPending}
          onSubmit={(email, replaceExisting) =>
            assignOwner.mutate(
              { tenantId: tenant.id, ownerEmail: email, replaceExisting },
              {
                onSuccess: () => {
                  toast.success(`${email} now owns ${tenant.name}`);
                  setAssigningOwner(false);
                },
                onError: (err) =>
                  toast.error(
                    err,
                    'Could not assign that owner. If they have no account yet, create it in Supabase Auth first.',
                  ),
              },
            )
          }
        />
      </Sheet>
    </Screen>
  );
}

function AssignOwnerForm({
  hasOwner,
  saving,
  onSubmit,
}: {
  readonly hasOwner: boolean;
  readonly saving: boolean;
  readonly onSubmit: (email: string, replaceExisting: boolean) => void;
}) {
  const theme = useTheme();
  const [email, setEmail] = useState('');
  const [replace, setReplace] = useState<'replace' | 'add'>(hasOwner ? 'replace' : 'add');

  const trimmed = email.trim();
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);

  return (
    <View style={{ gap: theme.spacing.lg }}>
      <Input
        label="Owner email"
        value={email}
        onChangeText={setEmail}
        placeholder="owner@example.com"
        autoCapitalize="none"
        keyboardType="email-address"
        error={trimmed !== '' && !valid ? 'That does not look like an email address.' : undefined}
        testID="assign-owner-email"
      />

      {hasOwner ? (
        <Select
          label="What happens to the current owner"
          value={replace}
          onChange={setReplace}
          options={[
            {
              value: 'replace',
              label: 'Replace them',
              hint: 'The club changed hands — the previous owner loses access',
            },
            {
              value: 'add',
              label: 'Add alongside',
              hint: 'A partnership — both keep access',
            },
          ]}
        />
      ) : null}

      <Button
        label="Assign owner"
        fullWidth
        disabled={!valid}
        loading={saving}
        onPress={() => onSubmit(trimmed, replace === 'replace')}
        testID="submit-assign-owner"
      />

      <Text variant="caption" color="textMuted">
        An owner can run any number of clubs. Assigning a club to someone who already owns one adds
        to their list rather than moving them.
      </Text>
    </View>
  );
}

function BrandingSheet({
  visible,
  onClose,
  tenant,
}: {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly tenant: Tenant;
}) {
  const theme = useTheme();
  const toast = useToast();
  const save = useUpdateTenantBranding();

  const [name, setName] = useState(tenant.name);
  const [primary, setPrimary] = useState(tenant.primary_color);
  const [secondary, setSecondary] = useState(tenant.secondary_color ?? '');
  const [preset, setPreset] = useState<string | null>(tenant.theme_preset);
  const [logoUrl, setLogoUrl] = useState(tenant.logo_url ?? '');
  const [contactName, setContactName] = useState(tenant.contact_name ?? '');
  const [contactEmail, setContactEmail] = useState(tenant.contact_email ?? '');
  const [contactPhone, setContactPhone] = useState(tenant.contact_phone ?? '');
  const [addressLine1, setAddressLine1] = useState(tenant.address_line1 ?? '');
  const [city, setCity] = useState(tenant.city ?? '');
  const [state, setState] = useState(tenant.state ?? '');

  const hex = /^#[0-9a-fA-F]{6}$/;
  const primaryValid = hex.test(primary);
  const secondaryValid = secondary === '' || hex.test(secondary);
  const canSave = name.trim().length > 1 && primaryValid && secondaryValid;

  // Live preview of the palette the club will actually get, contrast fixes and
  // all — the same builder the app itself runs.
  const preview = buildTheme(
    {
      clubName: name,
      logoUrl: logoUrl || null,
      primaryColor: primaryValid ? primary : tenant.primary_color,
      secondaryColor: secondaryValid && secondary !== '' ? secondary : null,
    },
    theme.scheme,
  );

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Branding"
      subtitle={`How ${tenant.name} looks to its staff`}
      testID="branding-sheet"
    >
      <View style={{ gap: theme.spacing.lg }}>
        <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
          <Swatch label="Primary" color={preview.colors.primary} />
          <Swatch label="Secondary" color={preview.colors.secondary} />
          <Swatch label="Container" color={preview.colors.primaryContainer} />
        </View>

        <Input label="Club name" value={name} onChangeText={setName} autoCapitalize="words" />

        <Input
          label="Primary colour"
          value={primary}
          onChangeText={setPrimary}
          autoCapitalize="none"
          placeholder="#0F766E"
          error={primaryValid ? undefined : 'Use a six-digit hex colour, e.g. #0F766E.'}
          testID="branding-primary"
        />

        <Input
          label="Secondary colour"
          value={secondary}
          onChangeText={setSecondary}
          autoCapitalize="none"
          placeholder="Optional"
          error={secondaryValid ? undefined : 'Use a six-digit hex colour, or leave it blank.'}
        />

        <Select
          label="Preset"
          value={preset}
          onChange={(value) => {
            setPreset(value);
            const chosen = THEME_PRESETS.find((item) => item.id === value);
            if (chosen) {
              setPrimary(chosen.primaryColor);
              setSecondary(chosen.secondaryColor ?? '');
            }
          }}
          options={THEME_PRESETS.map((item) => ({ value: item.id, label: item.label }))}
        />

        <Input
          label="Logo URL"
          value={logoUrl}
          onChangeText={setLogoUrl}
          autoCapitalize="none"
          placeholder="Optional — leave blank to remove"
        />

        <Divider />

        <Input label="Contact name" value={contactName} onChangeText={setContactName} />
        <Input
          label="Contact email"
          value={contactEmail}
          onChangeText={setContactEmail}
          autoCapitalize="none"
          keyboardType="email-address"
        />
        <Input
          label="Contact phone"
          value={contactPhone}
          onChangeText={setContactPhone}
          keyboardType="phone-pad"
        />
        <Input label="Address" value={addressLine1} onChangeText={setAddressLine1} />
        <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
          <View style={{ flex: 1 }}>
            <Input label="City" value={city} onChangeText={setCity} />
          </View>
          <View style={{ flex: 1 }}>
            <Input label="State" value={state} onChangeText={setState} />
          </View>
        </View>

        <Button
          label="Save branding"
          fullWidth
          disabled={!canSave}
          loading={save.isPending}
          testID="save-branding"
          onPress={() =>
            save.mutate(
              {
                tenantId: tenant.id,
                name: name.trim(),
                primaryColor: primary,
                secondaryColor: secondary,
                ...(preset === null ? {} : { themePreset: preset }),
                // The RPC coalesces its arguments, so an empty string cannot
                // mean "remove". Clearing needs its own flag.
                ...(logoUrl === '' ? { clearLogo: true } : { logoUrl }),
                contactName,
                contactEmail,
                contactPhone,
                addressLine1,
                city,
                state,
              },
              {
                onSuccess: () => {
                  toast.success('Branding saved');
                  onClose();
                },
                onError: (error) => toast.error(error, 'Could not save the branding.'),
              },
            )
          }
        />
      </View>
    </Sheet>
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
