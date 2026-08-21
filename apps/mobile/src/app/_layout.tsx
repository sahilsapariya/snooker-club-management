import { Stack } from 'expo-router';
import 'react-native-gesture-handler';

import { AppProviders } from '@/providers/AppProviders';

/**
 * Root layout.
 *
 * Route groups mirror the audiences of the product:
 *
 *   (auth)       signed out
 *   select-club  signed in, several clubs, none chosen yet
 *   (tenant)     club staff: owner and receptionist, in one club at a time
 *   (platform)   product owner and support
 *
 * The split keeps platform administration out of a club user's navigation
 * entirely. It is not a security boundary - Row Level Security is - but it does
 * mean the two experiences never bleed into one another.
 */
export default function RootLayout() {
  return (
    <AppProviders>
      <Stack screenOptions={{ headerShown: false, animation: 'fade' }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="select-club" />
        <Stack.Screen name="(tenant)" />
        <Stack.Screen name="(platform)" />
      </Stack>
    </AppProviders>
  );
}
