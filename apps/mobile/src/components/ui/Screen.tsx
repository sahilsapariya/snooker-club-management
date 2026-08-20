import type { ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

import { useTheme } from '@/theme';

export interface ScreenProps {
  readonly children: ReactNode;
  readonly scrollable?: boolean;
  /**
   * Lifts content above the keyboard. React Native's own
   * `KeyboardAvoidingView` is used rather than a native keyboard library so the
   * app keeps working in Expo Go; see docs/architecture.md.
   */
  readonly avoidKeyboard?: boolean;
  readonly padded?: boolean;
  readonly edges?: readonly Edge[];
  readonly style?: ViewStyle;
  readonly contentContainerStyle?: ViewStyle;
  readonly testID?: string;
}

/** Screen shell: safe area, themed background, optional scroll and keyboard lift. */
export function Screen({
  children,
  scrollable = false,
  avoidKeyboard = false,
  padded = true,
  edges = ['top', 'left', 'right'],
  style,
  contentContainerStyle,
  testID,
}: ScreenProps) {
  const theme = useTheme();
  const padding = padded ? theme.spacing.lg : 0;

  const body = scrollable ? (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={[{ padding, flexGrow: 1 }, contentContainerStyle]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.flex, { padding }, contentContainerStyle]}>{children}</View>
  );

  return (
    <SafeAreaView
      testID={testID}
      edges={[...edges]}
      style={[styles.flex, { backgroundColor: theme.colors.background }, style]}
    >
      {avoidKeyboard ? (
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          {body}
        </KeyboardAvoidingView>
      ) : (
        body
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
});
