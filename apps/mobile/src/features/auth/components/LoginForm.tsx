import { zodResolver } from '@hookform/resolvers/zod';
import { KeyRound, Mail } from 'lucide-react-native';
import { Controller, useForm } from 'react-hook-form';
import { View } from 'react-native';

import { Button, Input, Text } from '@/components/ui';
import { AppError } from '@/lib/errors';
import { useTheme } from '@/theme';

import { useSignIn } from '../hooks/use-app-session';
import { signInSchema, type SignInFormValues } from '../schema';

export interface LoginFormProps {
  /** Shown above the form when a previous session ended unexpectedly. */
  readonly notice?: string;
}

export function LoginForm({ notice }: LoginFormProps) {
  const theme = useTheme();
  const signIn = useSignIn();

  const { control, handleSubmit, formState } = useForm<SignInFormValues>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: '', password: '' },
    mode: 'onBlur',
  });

  const submitError = signIn.error instanceof AppError ? signIn.error.userMessage : null;

  const onSubmit = handleSubmit((values) => {
    signIn.mutate(values);
  });

  return (
    <View style={{ gap: theme.spacing.lg }}>
      {notice ? (
        <View
          style={{
            backgroundColor: theme.colors.warningContainer,
            borderRadius: theme.radius.md,
            padding: theme.spacing.md,
          }}
        >
          <Text variant="bodySm" style={{ color: theme.colors.onWarningContainer }}>
            {notice}
          </Text>
        </View>
      ) : null}

      <Controller
        control={control}
        name="email"
        render={({ field, fieldState }) => (
          <Input
            label="Email"
            icon={Mail}
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={fieldState.error?.message}
            placeholder="you@club.com"
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            textContentType="emailAddress"
            returnKeyType="next"
            testID="login-email"
          />
        )}
      />

      <Controller
        control={control}
        name="password"
        render={({ field, fieldState }) => (
          <Input
            label="Password"
            icon={KeyRound}
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={fieldState.error?.message}
            placeholder="Your password"
            secureTextEntry
            autoCapitalize="none"
            autoComplete="current-password"
            textContentType="password"
            returnKeyType="go"
            onSubmitEditing={onSubmit}
            testID="login-password"
          />
        )}
      />

      {submitError ? (
        <View
          style={{
            backgroundColor: theme.colors.errorContainer,
            borderRadius: theme.radius.md,
            padding: theme.spacing.md,
          }}
        >
          <Text
            variant="bodySm"
            style={{ color: theme.colors.onErrorContainer }}
            accessibilityLiveRegion="polite"
          >
            {submitError}
          </Text>
        </View>
      ) : null}

      <Button
        label="Sign in"
        onPress={onSubmit}
        loading={signIn.isPending || formState.isSubmitting}
        fullWidth
        size="lg"
        testID="login-submit"
      />

      <Text variant="caption" color="textMuted" align="center">
        Accounts are created by your club owner or the platform administrator.
      </Text>
    </View>
  );
}
