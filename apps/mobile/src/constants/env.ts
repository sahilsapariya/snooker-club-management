import { z } from 'zod';

/**
 * Validated access to the app's public configuration.
 *
 * Expo replaces `process.env.EXPO_PUBLIC_*` with literals at build time, which
 * is why each one is read as a full static member expression rather than
 * through a computed key - a dynamic lookup would not be substituted and would
 * be `undefined` in a release build.
 *
 * Everything here is public by definition. Secrets live server-side; see
 * apps/mobile/.env.example.
 */
const EnvSchema = z.object({
  supabaseUrl: z.url({ error: 'EXPO_PUBLIC_SUPABASE_URL must be a valid URL' }),
  supabaseAnonKey: z
    .string()
    .min(20, { error: 'EXPO_PUBLIC_SUPABASE_ANON_KEY looks empty or truncated' }),
  appEnv: z.enum(['development', 'preview', 'production', 'test']).default('development'),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).optional(),
});

export type Env = z.infer<typeof EnvSchema>;

function readEnv(): Env {
  const parsed = EnvSchema.safeParse({
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
    appEnv: process.env.EXPO_PUBLIC_APP_ENV,
    logLevel: process.env.EXPO_PUBLIC_LOG_LEVEL,
  });

  if (!parsed.success) {
    const detail = parsed.error.issues.map((issue) => `  - ${issue.message}`).join('\n');
    // Failing loudly at startup is the right trade: a misconfigured build that
    // boots and then fails every request is far harder to diagnose.
    throw new Error(
      `Invalid app configuration.\n${detail}\n\n` +
        'Copy apps/mobile/.env.example to apps/mobile/.env and fill it in, then restart the bundler.',
    );
  }

  return parsed.data;
}

export const env: Env = readEnv();

export const isDevelopment = env.appEnv === 'development';
export const isProduction = env.appEnv === 'production';
