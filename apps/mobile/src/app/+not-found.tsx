import { router } from 'expo-router';
import { Compass } from 'lucide-react-native';

import { Button, EmptyState, Screen } from '@/components/ui';

export default function NotFoundScreen() {
  return (
    <Screen>
      <EmptyState
        icon={Compass}
        title="That screen does not exist"
        description="The link may be out of date."
      />
      <Button label="Back to the start" variant="secondary" onPress={() => router.replace('/')} />
    </Screen>
  );
}
