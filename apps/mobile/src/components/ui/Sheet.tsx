import { X } from 'lucide-react-native';
import type { ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Modal as RNModal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/theme';

import { IconButton } from './misc';
import { Text } from './Text';

export interface SheetProps {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly title: string;
  readonly subtitle?: string;
  readonly children: ReactNode;
  /** Pinned to the bottom, outside the scroll area. */
  readonly footer?: ReactNode;
  readonly testID?: string;
}

/**
 * Bottom sheet.
 *
 * Built on React Native's own `Modal` rather than a gesture library, because
 * the app has to keep running in Expo Go and every native-module sheet needs a
 * development build. The trade is no drag-to-dismiss; tapping the backdrop or
 * the close button does the job, and the hardware back button works on Android
 * for free via `onRequestClose`.
 *
 * Content scrolls, the footer does not, so the primary action stays reachable
 * with a keyboard open.
 */
export function Sheet({ visible, onClose, title, subtitle, children, footer, testID }: SheetProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <RNModal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={[styles.backdrop, { backgroundColor: theme.colors.overlay }]}>
        {/* Tap-outside-to-dismiss. Not a button to screen readers - the close
            control below is the accessible affordance. */}
        <Pressable
          style={StyleSheet.absoluteFill}
          accessibilityElementsHidden
          importantForAccessibility="no"
          onPress={onClose}
        />

        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.keyboardWrap}
          pointerEvents="box-none"
        >
          <View
            testID={testID}
            accessibilityViewIsModal
            style={[
              styles.sheet,
              {
                backgroundColor: theme.colors.surface,
                borderTopLeftRadius: theme.radius['2xl'],
                borderTopRightRadius: theme.radius['2xl'],
                paddingBottom: insets.bottom + theme.spacing.md,
                ...theme.elevation(3),
              },
            ]}
          >
            <View style={[styles.grabber, { backgroundColor: theme.colors.borderStrong }]} />

            <View
              style={[
                styles.header,
                { paddingHorizontal: theme.spacing.lg, gap: theme.spacing.md },
              ]}
            >
              <View style={styles.grow}>
                <Text variant="titleLg">{title}</Text>
                {subtitle ? (
                  <Text variant="bodySm" color="textMuted">
                    {subtitle}
                  </Text>
                ) : null}
              </View>
              <IconButton icon={X} onPress={onClose} accessibilityLabel="Close" />
            </View>

            <ScrollView
              contentContainerStyle={{ padding: theme.spacing.lg, paddingTop: theme.spacing.sm }}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {children}
            </ScrollView>

            {footer ? (
              <View
                style={[
                  styles.footer,
                  {
                    padding: theme.spacing.lg,
                    borderTopColor: theme.colors.border,
                    backgroundColor: theme.colors.surface,
                  },
                ]}
              >
                {footer}
              </View>
            ) : null}
          </View>
        </KeyboardAvoidingView>
      </View>
    </RNModal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  keyboardWrap: { justifyContent: 'flex-end' },
  sheet: { maxHeight: '88%', overflow: 'hidden' },
  grabber: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 6,
  },
  header: { flexDirection: 'row', alignItems: 'center' },
  grow: { flex: 1 },
  footer: { borderTopWidth: StyleSheet.hairlineWidth },
});
