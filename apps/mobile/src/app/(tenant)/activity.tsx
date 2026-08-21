import { History, Lock } from 'lucide-react-native';
import { useMemo } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';

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
import { useTenantActivity, type ActivityEntry } from '@/features/activity';
import { useAppSession } from '@/features/auth';
import { useTheme } from '@/theme';

/**
 * What has happened in this club, and who did it.
 *
 * Owner-only by construction rather than by check: the SELECT policy on
 * `activity_logs` requires `app.can_manage_tenant(tenant_id)`, so a
 * receptionist calling `tenant_activity` receives an empty list. Staff generate
 * the trail; owners read it.
 *
 * Every entry belongs to exactly one club. For an owner running several, that
 * is the whole point — "a table was taken out of service" is not useful
 * information until you know where.
 */
export default function ActivityScreen() {
  const theme = useTheme();
  const session = useAppSession();

  const isOwner = session.status === 'tenant-user' && session.role === 'OWNER';
  const tenantId = session.status === 'tenant-user' ? session.tenant.id : null;
  const activity = useTenantActivity(isOwner ? tenantId : null, 100);

  const grouped = useMemo(() => groupByDay(activity.data ?? []), [activity.data]);

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
          description="The activity trail records who changed what. Only the club owner can read it."
        />
      </Screen>
    );
  }

  return (
    <Screen padded={false} testID="activity-screen">
      <ScrollView
        contentContainerStyle={{
          padding: theme.spacing.lg,
          gap: theme.spacing.xl,
          paddingBottom: theme.spacing['5xl'],
        }}
        refreshControl={
          <RefreshControl
            refreshing={activity.isRefetching}
            onRefresh={() => void activity.refetch()}
          />
        }
      >
        {activity.isError ? (
          <ErrorState error={activity.error} onRetry={() => void activity.refetch()} />
        ) : null}
        {activity.isPending ? <LoadingState label="Loading activity" /> : null}

        {!activity.isPending && (activity.data ?? []).length === 0 ? (
          <EmptyState
            icon={History}
            title="Nothing recorded yet"
            description={`Changes made in ${session.tenant.name} will appear here.`}
          />
        ) : null}

        {grouped.map(([day, entries]) => (
          <View key={day}>
            <SectionHeader title={day} subtitle={`${entries.length} entries`} />
            <Card style={{ gap: theme.spacing.xs }}>
              {entries.map((entry, index) => (
                <View key={entry.id}>
                  {index > 0 ? <Divider /> : null}
                  <ActivityRow entry={entry} />
                </View>
              ))}
            </Card>
          </View>
        ))}
      </ScrollView>
    </Screen>
  );
}

function ActivityRow({ entry }: { readonly entry: ActivityEntry }) {
  const theme = useTheme();
  const actor = entry.actor_name ?? entry.actor_email ?? 'Someone';
  const time = new Date(entry.created_at).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <View
      style={{ flexDirection: 'row', gap: theme.spacing.md, paddingVertical: theme.spacing.sm }}
    >
      <Text variant="caption" color="textMuted" style={{ width: 52 }}>
        {time}
      </Text>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="bodySm">{entry.summary ?? humanise(entry.action)}</Text>
        <Text variant="caption" color="textMuted">
          {actor}
        </Text>
      </View>
      {entry.actor_role ? (
        <Badge
          label={roleLabel(entry.actor_role)}
          tone={
            entry.actor_role === 'PLATFORM'
              ? 'info'
              : entry.actor_role === 'OWNER'
                ? 'brand'
                : 'neutral'
          }
        />
      ) : null}
    </View>
  );
}

/** `table.deactivated` reads better as "Table deactivated" when no summary was written. */
function humanise(action: string): string {
  const words = action.replace(/[._]/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function roleLabel(role: string): string {
  if (role === 'PLATFORM') return 'Platform';
  if (role === 'OWNER') return 'Owner';
  return 'Reception';
}

/**
 * Days, newest first, preserving the order the server returned within each day.
 *
 * A Map keeps insertion order, so this relies on `tenant_activity` already
 * sorting by `created_at desc` rather than sorting again here.
 */
function groupByDay(entries: readonly ActivityEntry[]): [string, ActivityEntry[]][] {
  const days = new Map<string, ActivityEntry[]>();

  for (const entry of entries) {
    const day = new Date(entry.created_at).toLocaleDateString(undefined, {
      weekday: 'long',
      day: 'numeric',
      month: 'short',
    });
    const bucket = days.get(day);
    if (bucket) bucket.push(entry);
    else days.set(day, [entry]);
  }

  return [...days.entries()];
}
