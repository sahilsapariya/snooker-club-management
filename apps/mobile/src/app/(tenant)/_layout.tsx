import { Redirect, Tabs } from 'expo-router';
import { Bell, LayoutGrid, MoreHorizontal, Timer, Wallet } from 'lucide-react-native';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LoadingState, Screen } from '@/components/ui';
import { ActiveClubBar, useAppSession } from '@/features/auth';
import { usePushRegistration, useUnreadNotificationCount } from '@/features/notifications';
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
 *
 * Above the tabs sits the active-club bar. It is here, in the shell, rather
 * than on each screen, so that no screen can be built that forgets to say which
 * club its numbers belong to.
 */
export default function TenantLayout() {
  const theme = useTheme();
  const session = useAppSession();

  const userId = session.status === 'tenant-user' ? session.profile.id : null;
  const tenantId = session.status === 'tenant-user' ? session.tenant.id : null;

  usePushRegistration(userId, tenantId);
  // Read here rather than in the Alerts screen: the badge has to be right on
  // every screen, and the screen it points at is the one place it is not needed.
  const unread = useUnreadNotificationCount(tenantId);

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
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: theme.colors.surface }}>
      <ActiveClubBar
        tenant={session.tenant}
        clubs={session.clubs}
        canSwitch={session.canSwitchClubs}
        testID="active-club-bar"
      />
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
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
              // Capped rather than truncated: past a certain point the exact
              // number stops being information and starts being a reason to
              // give up on the tab entirely.
              ...(unread.data && unread.data > 0
                ? { tabBarBadge: unread.data > 99 ? '99+' : unread.data }
                : {}),
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
          <Tabs.Screen name="tables-setup" options={{ href: null, title: 'Tables' }} />
          <Tabs.Screen name="staff" options={{ href: null, title: 'Staff' }} />
          <Tabs.Screen name="billing" options={{ href: null, title: 'Billing rules' }} />
          <Tabs.Screen name="activity" options={{ href: null, title: 'Activity' }} />
          <Tabs.Screen name="expenses" options={{ href: null, title: 'Expenses' }} />
        </Tabs>
      </View>
    </SafeAreaView>
  );
}
