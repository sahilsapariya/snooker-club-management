import { Redirect, Tabs } from 'expo-router';
import { Bell, LayoutGrid, MoreHorizontal, Timer, Wallet } from 'lucide-react-native';

import { LoadingState, Screen } from '@/components/ui';
import { useAppSession } from '@/features/auth';
import { usePushRegistration } from '@/features/notifications';
import { useTheme } from '@/theme';

/**
 * Club staff shell.
 *
 * Only the four things a receptionist touches during a shift get a tab, plus
 * "More". Reports, Manage and Settings are routable but hidden from the bar
 * (`href: null`) - a six or seven item tab bar makes every target too small to
 * hit reliably one-handed at a counter.
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
        name="cash"
        options={{
          title: 'Cash',
          tabBarIcon: ({ color, size }) => <Wallet color={color} size={size} />,
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
        name="more"
        options={{
          title: 'More',
          tabBarIcon: ({ color, size }) => <MoreHorizontal color={color} size={size} />,
        }}
      />

      {/* Reachable by route, deliberately absent from the tab bar. */}
      <Tabs.Screen name="reports" options={{ href: null, title: 'Reports' }} />
      <Tabs.Screen name="manage" options={{ href: null, title: 'Manage club' }} />
      <Tabs.Screen name="settings" options={{ href: null, title: 'Settings' }} />
    </Tabs>
  );
}
