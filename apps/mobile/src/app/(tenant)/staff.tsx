import { Lock, UserPlus, Users } from 'lucide-react-native';
import { useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';

import {
  Avatar,
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
  useAddStaffMember,
  useSetStaffStatus,
  useStaff,
  type StaffMember,
  type TenantRole,
} from '@/features/staff';
import { useTheme } from '@/theme';

/**
 * Who works at this club.
 *
 * Per club, never per owner: someone running three clubs has three teams, and
 * presenting them as one roster would be both wrong and dangerous - suspending
 * "a receptionist" would silently do it everywhere.
 *
 * Two limits here are deliberate and worth understanding rather than working
 * around:
 *
 *   No account creation. Making a Supabase Auth user needs privileges the
 *   mobile app must never hold. The account is created first; this screen links
 *   it to the club.
 *
 *   No ownership. `add_tenant_member` refuses OWNER unless the platform is
 *   asking. Who owns a club is a commercial relationship, decided by the
 *   platform, not by whoever currently holds the login.
 */
export default function StaffScreen() {
  const theme = useTheme();
  const toast = useToast();
  const session = useAppSession();

  const isOwner = session.status === 'tenant-user' && session.role === 'OWNER';
  const tenantId = session.status === 'tenant-user' ? session.tenant.id : null;

  const staff = useStaff(isOwner ? tenantId : null);
  const addMember = useAddStaffMember(tenantId);
  const setStatus = useSetStaffStatus(tenantId);

  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<StaffMember | null>(null);

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
          description="Only the club owner can add staff or change who has access."
        />
      </Screen>
    );
  }

  const members = staff.data ?? [];
  const activeMembers = members.filter((member) => member.status === 'ACTIVE');
  const inactiveMembers = members.filter((member) => member.status !== 'ACTIVE');

  return (
    <Screen padded={false} testID="staff-screen">
      <ScrollView
        contentContainerStyle={{
          padding: theme.spacing.lg,
          gap: theme.spacing.xl,
          paddingBottom: theme.spacing['5xl'],
        }}
        refreshControl={
          <RefreshControl refreshing={staff.isRefetching} onRefresh={() => void staff.refetch()} />
        }
      >
        {staff.isError ? (
          <ErrorState error={staff.error} onRetry={() => void staff.refetch()} />
        ) : null}
        {staff.isPending ? <LoadingState label="Loading staff" /> : null}

        <View>
          <SectionHeader
            title="Working here"
            subtitle={`${activeMembers.length} with access to ${session.tenant.name}`}
            action={{ label: 'Add staff', onPress: () => setAdding(true) }}
          />

          {activeMembers.length === 0 && !staff.isPending ? (
            <EmptyState
              icon={Users}
              title="Nobody yet"
              description="Add the people who run the counter."
            />
          ) : (
            <Card style={{ gap: theme.spacing.xs }}>
              {activeMembers.map((member, index) => (
                <View key={member.membership_id}>
                  {index > 0 ? <Divider /> : null}
                  <StaffRow member={member} onPress={() => setSelected(member)} />
                </View>
              ))}
            </Card>
          )}
        </View>

        {inactiveMembers.length > 0 ? (
          <View>
            <SectionHeader
              title="No longer working here"
              subtitle="Kept so their past sessions and payments still make sense"
            />
            <Card style={{ gap: theme.spacing.xs }}>
              {inactiveMembers.map((member, index) => (
                <View key={member.membership_id}>
                  {index > 0 ? <Divider /> : null}
                  <StaffRow member={member} onPress={() => setSelected(member)} />
                </View>
              ))}
            </Card>
          </View>
        ) : null}
      </ScrollView>

      <AddStaffSheet
        visible={adding}
        onClose={() => setAdding(false)}
        saving={addMember.isPending}
        onSubmit={(email, role) =>
          addMember.mutate(
            { email, role },
            {
              onSuccess: () => {
                toast.success(`${email} now has access`);
                setAdding(false);
              },
              onError: (error) => toast.error(error, 'Could not add that person.'),
            },
          )
        }
      />

      <StaffDetailSheet
        member={selected}
        onClose={() => setSelected(null)}
        saving={setStatus.isPending}
        isSelf={selected?.user_id === session.profile.id}
        onSetStatus={(status) => {
          if (!selected) return;
          setStatus.mutate(
            { membershipId: selected.membership_id, status },
            {
              onSuccess: () => {
                toast.success(
                  status === 'ACTIVE'
                    ? `${selected.full_name ?? selected.email} can sign in again`
                    : `${selected.full_name ?? selected.email} no longer has access`,
                );
                setSelected(null);
              },
              onError: (error) => toast.error(error, 'Could not change their access.'),
            },
          );
        }}
      />
    </Screen>
  );
}

function StaffRow({
  member,
  onPress,
}: {
  readonly member: StaffMember;
  readonly onPress: () => void;
}) {
  const theme = useTheme();
  const name = member.full_name ?? member.email;

  return (
    <ListItem
      title={name}
      subtitle={member.email}
      showChevron
      onPress={onPress}
      testID={`staff-row-${member.membership_id}`}
      trailing={
        <View style={{ flexDirection: 'row', gap: theme.spacing.xs, alignItems: 'center' }}>
          <Badge
            label={member.role === 'OWNER' ? 'Owner' : 'Reception'}
            tone={member.role === 'OWNER' ? 'brand' : 'neutral'}
          />
          {member.status !== 'ACTIVE' ? <Badge label="No access" tone="error" /> : null}
          {member.account_active === false ? <Badge label="Disabled" tone="warning" /> : null}
        </View>
      }
    />
  );
}

function AddStaffSheet({
  visible,
  onClose,
  saving,
  onSubmit,
}: {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly saving: boolean;
  readonly onSubmit: (email: string, role: TenantRole) => void;
}) {
  const theme = useTheme();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<TenantRole>('RECEPTIONIST');

  const trimmed = email.trim();
  const looksLikeEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Add someone to this club"
      subtitle="They need a Club Desk account already"
      testID="add-staff-sheet"
    >
      <View style={{ gap: theme.spacing.lg }}>
        <Input
          label="Email address"
          value={email}
          onChangeText={setEmail}
          placeholder="name@example.com"
          autoCapitalize="none"
          keyboardType="email-address"
          hint="Must match the address they sign in with."
          error={
            trimmed !== '' && !looksLikeEmail
              ? 'That does not look like an email address.'
              : undefined
          }
          testID="staff-email"
        />

        <Select
          label="Role"
          value={role}
          onChange={setRole}
          options={[
            {
              value: 'RECEPTIONIST',
              label: 'Receptionist',
              hint: 'Runs sessions, takes payments, records expenses',
            },
          ]}
        />

        <Text variant="caption" color="textMuted">
          A receptionist can only work at one club at a time. Adding someone who already works
          elsewhere will be refused — ask their current club to release them first.
        </Text>

        <Button
          label="Give access"
          icon={UserPlus}
          fullWidth
          disabled={!looksLikeEmail}
          loading={saving}
          onPress={() => onSubmit(trimmed, role)}
          testID="submit-staff"
        />

        <Text variant="caption" color="textMuted">
          Only the platform can make someone a club owner.
        </Text>
      </View>
    </Sheet>
  );
}

function StaffDetailSheet({
  member,
  onClose,
  saving,
  isSelf,
  onSetStatus,
}: {
  readonly member: StaffMember | null;
  readonly onClose: () => void;
  readonly saving: boolean;
  readonly isSelf: boolean;
  readonly onSetStatus: (status: 'ACTIVE' | 'DISABLED') => void;
}) {
  const theme = useTheme();
  if (!member) return null;

  const name = member.full_name ?? member.email;
  const hasAccess = member.status === 'ACTIVE';

  return (
    <Sheet
      visible
      onClose={onClose}
      title={name}
      subtitle={member.email}
      testID="staff-detail-sheet"
    >
      <View style={{ gap: theme.spacing.lg }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
          <Avatar name={name} size={48} />
          <View style={{ flex: 1, gap: theme.spacing.xs }}>
            <Badge
              label={member.role === 'OWNER' ? 'Club owner' : 'Receptionist'}
              tone={member.role === 'OWNER' ? 'brand' : 'neutral'}
            />
            <Text variant="caption" color="textMuted">
              {member.joined_at
                ? `Joined ${new Date(member.joined_at).toLocaleDateString()}`
                : 'Not yet joined'}
            </Text>
          </View>
        </View>

        {isSelf ? (
          <Text variant="bodySm" color="textMuted">
            This is you. You cannot change your own access — ask another owner or the platform
            administrator.
          </Text>
        ) : (
          <>
            <Button
              label={hasAccess ? 'Remove access' : 'Restore access'}
              variant={hasAccess ? 'outline' : 'primary'}
              fullWidth
              loading={saving}
              onPress={() => onSetStatus(hasAccess ? 'DISABLED' : 'ACTIVE')}
              testID="toggle-staff-access"
            />
            <Text variant="caption" color="textMuted">
              Removing access signs them out of this club immediately. Their name stays on every
              session and payment they handled.
            </Text>
          </>
        )}
      </View>
    </Sheet>
  );
}
