import { Redirect, Tabs } from 'expo-router';
import { Bell, LayoutGrid, Settings, Timer } from 'lucide-react-native';

import { LoadingState, Screen } from '@/components/ui';
import { useAppSession } from '@/features/auth';
import { usePushRegistration } from '@/features/notifications';
import { useTheme } from '@/theme';

/**
 * Club staff shell.
 *
 * The redirect keeps a non-club user out of these screens, but it is a UX
 * guarantee, not a security one: were someone to reach `/tables` anyway, every
 * query behind it would return an empty set because Row Level Security has no
 * membership to match them against.
 */
export default function TenantLayout() {
  const theme = useTheme();
  const session = useAppSession();

  const userId = session.status === 'tenant-user' ? session.profile.id : null;
  const tenantId = session.status === 'tenant-user' ? session.tenant.id : null;

  usePushRegistration(userId, tenantId);

  if (session.status === 'loading') {
    return (
      <Screen>
        <LoadingState />
      </Screen>
    );
  }

  if (session.status !== 'tenant-user') {
    return <Redirect href="/" />;
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.colors.primaryOnSurface,
        tabBarInactiveTintColor: theme.colors.textMuted,
        tabBarStyle: {
          backgroundColor: theme.colors.surface,
          borderTopColor: theme.colors.border,
        },
        tabBarLabelStyle: theme.typography.caption,
      }}
    >
      <Tabs.Screen
        name="tables"
        options={{
          title: 'Tables',
          tabBarIcon: ({ color, size }) => <LayoutGrid color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="sessions"
        options={{
          title: 'Sessions',
          tabBarIcon: ({ color, size }) => <Timer color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="notifications"
        options={{
          title: 'Alerts',
          tabBarIcon: ({ color, size }) => <Bell color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, size }) => <Settings color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}
