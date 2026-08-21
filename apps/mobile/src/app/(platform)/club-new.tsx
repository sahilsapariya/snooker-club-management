import { router } from 'expo-router';
import { Building2 } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';

import {
  Button,
  Card,
  Input,
  Screen,
  SectionHeader,
  Select,
  Text,
  useToast,
} from '@/components/ui';
import { usePlatformOwners, useCreateClub } from '@/features/platform';
import { useTheme } from '@/theme';
import type { Database } from '@/types/database.types';

type TenantStatus = Database['public']['Enums']['tenant_status'];

const STATUSES: readonly { value: TenantStatus; label: string; hint: string }[] = [
  { value: 'TRIAL', label: 'Trial', hint: 'Fully usable, marked as evaluating' },
  { value: 'ACTIVE', label: 'Live', hint: 'A paying club' },
];

/**
 * Standing up a new club.
 *
 * One RPC does all of it in a single transaction: create the tenant, seed its
 * default table types, products, expense categories and billing settings via
 * the provisioning trigger, attach the owner, and write the audit entry. If any
 * step fails the whole thing rolls back — there is no state in which a club
 * exists but has no owner, or has an owner but no billing rules.
 *
 * The owner is chosen by email and must already have an account. Creating auth
 * users needs the service-role key, which never reaches this app; the operator
 * creates the account in Supabase first. `platform_create_club` raises P0002
 * with a hint rather than quietly making an ownerless club.
 */
export default function CreateClubScreen() {
  const theme = useTheme();
  const toast = useToast();
  const createClub = useCreateClub();
  const owners = usePlatformOwners();

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [ownerEmail, setOwnerEmail] = useState('');
  const [status, setStatus] = useState<TenantStatus>('TRIAL');
  const [primaryColor, setPrimaryColor] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [addressLine1, setAddressLine1] = useState('');
  const [contactPhone, setContactPhone] = useState('');

  // Suggested from the name until the operator edits it themselves, at which
  // point the suggestion stops fighting them.
  const suggestedSlug = useMemo(() => toSlug(name), [name]);
  const effectiveSlug = slugTouched ? slug : suggestedSlug;

  const trimmedName = name.trim();
  const trimmedEmail = ownerEmail.trim();
  const slugValid = /^[a-z0-9]+(-[a-z0-9]+)*$/.test(effectiveSlug);
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail);
  const colorValid = primaryColor === '' || /^#[0-9a-fA-F]{6}$/.test(primaryColor);

  const canSubmit = trimmedName.length > 1 && slugValid && emailValid && colorValid;

  const existingOwner = useMemo(
    () =>
      (owners.data ?? []).find(
        (owner) => owner.email.toLowerCase() === trimmedEmail.toLowerCase(),
      ) ?? null,
    [owners.data, trimmedEmail],
  );

  function handleCreate(): void {
    if (!canSubmit) return;

    createClub.mutate(
      {
        name: trimmedName,
        slug: effectiveSlug,
        ownerEmail: trimmedEmail,
        status,
        ...(primaryColor === '' ? {} : { primaryColor }),
        ...(city.trim() === '' ? {} : { city: city.trim() }),
        ...(state.trim() === '' ? {} : { state: state.trim() }),
        ...(addressLine1.trim() === '' ? {} : { addressLine1: addressLine1.trim() }),
        ...(contactPhone.trim() === '' ? {} : { contactPhone: contactPhone.trim() }),
      },
      {
        onSuccess: (tenant) => {
          toast.success(`${tenant.name} created`);
          router.replace(`/(platform)/tenant/${tenant.id}`);
        },
        onError: (error) =>
          toast.error(
            error,
            'Could not create the club. If the owner has no account yet, create it in Supabase Auth first.',
          ),
      },
    );
  }

  return (
    <Screen padded={false} testID="create-club-screen">
      <ScrollView
        contentContainerStyle={{
          padding: theme.spacing.lg,
          gap: theme.spacing.xl,
          paddingBottom: theme.spacing['5xl'],
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View>
          <SectionHeader title="The club" />
          <Card style={{ gap: theme.spacing.lg }}>
            <Input
              label="Name"
              value={name}
              onChangeText={setName}
              placeholder="Royal Snooker Club"
              autoCapitalize="words"
              testID="club-name"
            />
            <Input
              label="Short code"
              value={effectiveSlug}
              onChangeText={(value) => {
                setSlugTouched(true);
                setSlug(value.toLowerCase());
              }}
              placeholder="royal-snooker"
              autoCapitalize="none"
              hint="Lowercase letters, numbers and hyphens. Used in links and must be unique."
              error={
                effectiveSlug !== '' && !slugValid
                  ? 'Use lowercase letters, numbers and single hyphens.'
                  : undefined
              }
              testID="club-slug"
            />
            <Select
              label="Status"
              value={status}
              onChange={setStatus}
              options={[...STATUSES]}
              testID="club-status"
            />
          </Card>
        </View>

        <View>
          <SectionHeader title="Owner" subtitle="They must already have a Club Desk account" />
          <Card style={{ gap: theme.spacing.lg }}>
            <Input
              label="Owner email"
              value={ownerEmail}
              onChangeText={setOwnerEmail}
              placeholder="owner@example.com"
              autoCapitalize="none"
              keyboardType="email-address"
              error={
                trimmedEmail !== '' && !emailValid
                  ? 'That does not look like an email address.'
                  : undefined
              }
              testID="owner-email"
            />
            {existingOwner ? (
              <Text variant="caption" color="success">
                {existingOwner.full_name ?? existingOwner.email} already runs{' '}
                {existingOwner.clubs_count} {existingOwner.clubs_count === 1 ? 'club' : 'clubs'}.
                This will be another.
              </Text>
            ) : (
              <Text variant="caption" color="textMuted">
                If this address has no account yet, create it in Supabase Auth first — the app
                cannot create login accounts.
              </Text>
            )}
          </Card>
        </View>

        <View>
          <SectionHeader
            title="Branding and location"
            subtitle="Optional. Only the platform can change these later."
          />
          <Card style={{ gap: theme.spacing.lg }}>
            <Input
              label="Primary colour"
              value={primaryColor}
              onChangeText={setPrimaryColor}
              placeholder="#0F766E"
              autoCapitalize="none"
              hint="Six-digit hex. The whole app takes this colour for this club."
              error={colorValid ? undefined : 'Use a six-digit hex colour, e.g. #0F766E.'}
            />
            <Input
              label="Address"
              value={addressLine1}
              onChangeText={setAddressLine1}
              placeholder="Optional"
            />
            <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
              <View style={{ flex: 1 }}>
                <Input label="City" value={city} onChangeText={setCity} placeholder="Optional" />
              </View>
              <View style={{ flex: 1 }}>
                <Input label="State" value={state} onChangeText={setState} placeholder="Optional" />
              </View>
            </View>
            <Input
              label="Contact phone"
              value={contactPhone}
              onChangeText={setContactPhone}
              placeholder="Optional"
              keyboardType="phone-pad"
            />
          </Card>
        </View>

        <Button
          label="Create club"
          icon={Building2}
          size="lg"
          fullWidth
          disabled={!canSubmit}
          loading={createClub.isPending}
          onPress={handleCreate}
          testID="submit-create-club"
        />

        <Text variant="caption" color="textMuted">
          Creating a club also sets up its default table types, product categories, expense
          categories and billing rules. All of it happens in one transaction.
        </Text>
      </ScrollView>
    </Screen>
  );
}

function toSlug(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
