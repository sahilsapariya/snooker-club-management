import { Link } from 'expo-router';
import { Building2, LogOut } from 'lucide-react-native';
import { FlatList, RefreshControl, View } from 'react-native';

import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  Screen,
  Text,
} from '@/components/ui';
import { useAppSession, useSignOut } from '@/features/auth';
import { useTenants } from '@/features/platform/hooks/use-tenants';
import type { TenantStatus } from '@/features/platform/api/tenants.api';
import { useTheme } from '@/theme';

const STATUS_TONE: Record<TenantStatus, 'success' | 'info' | 'warning' | 'neutral'> = {
  ACTIVE: 'success',
  TRIAL: 'info',
  SUSPENDED: 'warning',
  ARCHIVED: 'neutral',
};

/** Platform admin landing screen: every club on the platform. */
export default function PlatformTenantsScreen() {
  const theme = useTheme();
  const session = useAppSession();
  const signOut = useSignOut();
  const { data, isPending, isError, error, refetch, isRefetching } = useTenants();

  return (
    <Screen padded={false} edges={['left', 'right']} testID="platform-tenants-screen">
      <View style={{ padding: theme.spacing.lg, gap: theme.spacing.xs }}>
        <Text variant="caption" color="textMuted">
          {session.status === 'platform-admin'
            ? session.platformRole.replace('_', ' ')
            : 'Platform'}
        </Text>
        <Text variant="displayMd">Clubs</Text>
        <Text variant="bodySm" color="textMuted">
          Branding, configuration and status for every tenant.
        </Text>
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
            paddingBottom: theme.spacing['3xl'],
            gap: theme.spacing.md,
            flexGrow: 1,
          }}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} />
          }
          renderItem={({ item }) => (
            <Link href={{ pathname: '/(platform)/tenant/[id]', params: { id: item.id } }} asChild>
              <Card onPress={() => undefined} style={{ gap: theme.spacing.sm }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
                  <View
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: theme.radius.md,
                      backgroundColor: item.primary_color,
                    }}
                  />
                  <View style={{ flex: 1 }}>
                    <Text variant="titleMd" numberOfLines={1}>
                      {item.name}
                    </Text>
                    <Text variant="caption" color="textMuted">
                      {item.slug} · {item.currency_code} · {item.timezone}
                    </Text>
                  </View>
                  <Badge label={item.status} tone={STATUS_TONE[item.status]} />
                </View>
              </Card>
            </Link>
          )}
          ListEmptyComponent={
            <EmptyState
              icon={Building2}
              title="No clubs yet"
              description="Create the first tenant to get started."
            />
          }
          ListFooterComponent={
            <Button
              label="Sign out"
              variant="ghost"
              icon={LogOut}
              onPress={() => void signOut()}
              style={{ marginTop: theme.spacing.xl }}
            />
          }
        />
      )}
    </Screen>
  );
}
