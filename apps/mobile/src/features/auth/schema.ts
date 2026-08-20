import { z } from 'zod';

/**
 * Client-side validation for the sign-in form.
 *
 * This exists to give immediate feedback, not to enforce anything. The password
 * policy that matters is configured in Supabase Auth (see supabase/config.toml)
 * and applied server-side.
 */
export const signInSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, { error: 'Enter your email address' })
    .pipe(z.email({ error: 'That does not look like an email address' })),
  password: z.string().min(1, { error: 'Enter your password' }),
});

export type SignInFormValues = z.infer<typeof signInSchema>;
