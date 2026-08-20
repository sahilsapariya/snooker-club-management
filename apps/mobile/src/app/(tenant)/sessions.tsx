import { Timer } from 'lucide-react-native';

import { EmptyState, Screen, SectionHeader } from '@/components/ui';

/**
 * Placeholder for the sessions workspace.
 *
 * The route, the tab and the shell exist now so that the billing and session
 * work lands in a place that already has navigation, theming and auth around
 * it. The screen itself is intentionally empty: implementing half a billing
 * engine would be worse than implementing none.
 */
export default function SessionsScreen() {
  return (
    <Screen testID="sessions-screen">
      <SectionHeader title="Sessions" subtitle="Open and recent play" />
      <EmptyState
        icon={Timer}
        title="Sessions arrive in the next stage"
        description="Starting, extending and closing sessions - with the configurable billing rules already modelled in the database - is the next piece of work."
      />
    </Screen>
  );
}
