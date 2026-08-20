import { BellOff } from 'lucide-react-native';
import { FlatList, RefreshControl, View } from 'react-native';

import {
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  Screen,
  SectionHeader,
  Text,
} from '@/components/ui';
import { useAppSession } from '@/features/auth';
import { useMarkNotificationRead, useNotificationInbox } from '@/features/notifications';
import { formatRelative } from '@/lib/format';
import { useTheme } from '@/theme';

/** Tenant-scoped in-app inbox. Push delivery is added server-side later. */
export default function NotificationsScreen() {
  const theme = useTheme();
  const session = useAppSession();
  const tenantId = session.status === 'tenant-user' ? session.tenant.id : null;

  const { data, isPending, isError, error, refetch, isRefetching } = useNotificationInbox(tenantId);
  const markRead = useMarkNotificationRead(tenantId);

  return (
    <Screen padded={false} testID="notifications-screen">
      <View style={{ paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.md }}>
        <SectionHeader title="Alerts" subtitle="Everything happening at this club" />
      </View>

      {isPending ? (
        <LoadingState />
      ) : isError ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : (
        <FlatList
          data={data}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{
            paddingHorizontal: theme.spacing.lg,
            paddingBottom: theme.spacing['4xl'],
            gap: theme.spacing.sm,
            flexGrow: 1,
          }}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} />
          }
          renderItem={({ item }) => (
            <Card
              padded
              {...(item.read_at ? {} : { onPress: () => markRead.mutate(item.id) })}
              style={{
                gap: theme.spacing.xs,
                borderColor: item.read_at ? theme.colors.border : theme.colors.primary,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
                <Text variant="titleSm" style={{ flex: 1 }} numberOfLines={2}>
                  {item.title}
                </Text>
                <Text variant="caption" color="textMuted">
                  {formatRelative(item.created_at)}
                </Text>
              </View>
              {item.body ? (
                <Text variant="bodySm" color="textSecondary">
                  {item.body}
                </Text>
              ) : null}
            </Card>
          )}
          ListEmptyComponent={
            <EmptyState
              icon={BellOff}
              title="Nothing to report"
              description="You are all caught up."
            />
          }
        />
      )}
    </Screen>
  );
}
