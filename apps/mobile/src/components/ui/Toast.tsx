import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react-native';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppError } from '@/lib/errors';
import { useTheme } from '@/theme';

import { Text } from './Text';

export type ToastTone = 'success' | 'error' | 'info';

interface ToastState {
  readonly id: number;
  readonly tone: ToastTone;
  readonly message: string;
}

interface ToastApi {
  show(message: string, tone?: ToastTone): void;
  success(message: string): void;
  /** Accepts an unknown throwable and renders only its user-facing message. */
  error(error: unknown, fallback?: string): void;
}

const ToastContext = createContext<ToastApi | null>(null);

const VISIBLE_MS = 3500;

/**
 * Transient confirmations.
 *
 * Deliberately not a modal: "Session started" should not need dismissing.
 * Errors get the same treatment so a failed action never blocks the till.
 *
 * `error()` takes `unknown` on purpose - callers pass whatever they caught and
 * this renders `AppError.userMessage`, never the technical detail. That makes
 * leaking a raw Postgres string into the UI difficult by construction.
 */
export function ToastProvider({ children }: { readonly children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const counter = useRef(0);

  const show = useCallback((message: string, tone: ToastTone = 'info') => {
    counter.current += 1;
    setToast({ id: counter.current, tone, message });
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      show,
      success: (message) => show(message, 'success'),
      error: (error, fallback = 'Something went wrong.') =>
        show(error instanceof AppError ? error.userMessage : fallback, 'error'),
    }),
    [show],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      {toast ? <ToastBanner key={toast.id} toast={toast} onDismiss={() => setToast(null)} /> : null}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error('useToast must be used inside a <ToastProvider>.');
  return api;
}

function ToastBanner({
  toast,
  onDismiss,
}: {
  readonly toast: ToastState;
  readonly onDismiss: () => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(opacity, {
      toValue: 1,
      duration: theme.motion.fast,
      useNativeDriver: true,
    }).start();

    const timer = setTimeout(() => {
      Animated.timing(opacity, {
        toValue: 0,
        duration: theme.motion.fast,
        useNativeDriver: true,
      }).start(onDismiss);
    }, VISIBLE_MS);

    return () => clearTimeout(timer);
  }, [opacity, onDismiss, theme.motion.fast]);

  const palette = {
    success: {
      bg: theme.colors.successContainer,
      fg: theme.colors.onSuccessContainer,
      Icon: CheckCircle2,
    },
    error: {
      bg: theme.colors.errorContainer,
      fg: theme.colors.onErrorContainer,
      Icon: AlertTriangle,
    },
    info: { bg: theme.colors.infoContainer, fg: theme.colors.onInfoContainer, Icon: Info },
  }[toast.tone];

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[styles.wrap, { top: insets.top + theme.spacing.sm, opacity }]}
    >
      <View
        accessibilityLiveRegion="polite"
        accessibilityRole="alert"
        style={[
          styles.banner,
          {
            backgroundColor: palette.bg,
            borderRadius: theme.radius.md,
            paddingVertical: theme.spacing.md,
            paddingHorizontal: theme.spacing.lg,
            gap: theme.spacing.sm,
            marginHorizontal: theme.spacing.lg,
            ...theme.elevation(2),
          },
        ]}
      >
        <palette.Icon size={18} color={palette.fg} />
        <Text variant="bodySm" style={{ color: palette.fg, flex: 1 }}>
          {toast.message}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
          hitSlop={10}
          onPress={onDismiss}
        >
          <X size={16} color={palette.fg} />
        </Pressable>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, zIndex: 1000 },
  banner: { flexDirection: 'row', alignItems: 'center' },
});
