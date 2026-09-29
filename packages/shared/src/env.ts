import { z } from 'zod';

const optional = z
  .string()
  .optional()
  .transform((v) => (v === '' ? undefined : v));

/** Public vars: safe to ship in the client bundle. */
export const publicEnvSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: optional,
  NEXT_PUBLIC_SENTRY_DSN: optional,
  NEXT_PUBLIC_POSTHOG_KEY: optional,
  NEXT_PUBLIC_POSTHOG_HOST: optional,
});

/** Server-only vars: must never reach the client bundle. */
export const serverEnvSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  SUPABASE_PROJECT_REF: z.string().min(10),
  UPSTASH_REDIS_REST_URL: z.url(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(20),
  BREVO_API_KEY: z.string().startsWith('xkeysib-'),
  BREVO_SENDER_EMAIL: z.email(),
  BREVO_SENDER_NAME: z.string().default('Baha Ready'),
  BREVO_SMS_SENDER: optional,
  SMS_OTP_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  ATTEMPT_TOKEN_SECRET: z.string().min(32),
  EMAIL_WEBHOOK_SECRET: z.string().min(32),
  CRON_SECRET: z.string().min(32),
  VAPID_PRIVATE_KEY: optional,
  FCM_SERVICE_ACCOUNT_JSON: optional,
  SENTRY_AUTH_TOKEN: optional,
  WEATHER_LAT: z.coerce.number().min(-90).max(90).default(14.23),
  WEATHER_LON: z.coerce.number().min(-180).max(180).default(121.36),
});

/** Keys that must never appear in client bundles (checked in CI). */
export const SERVER_ONLY_KEYS = Object.keys(serverEnvSchema.shape);

/** Tooling-only keys used by scripts/setup.ts (not needed at runtime). */
export const toolingEnvSchema = z.object({
  SUPABASE_ACCESS_TOKEN: z.string().startsWith('sbp_'),
  SUPABASE_DB_PASSWORD: z.string().min(8),
  VERCEL_TOKEN: z.string().min(10),
  BREVO_SMTP_LOGIN: optional,
  BREVO_SMTP_KEY: z.string().startsWith('xsmtpsib-'),
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;
export type ServerEnv = z.infer<typeof serverEnvSchema>;

/** Format zod issues listing key names only, never values. */
export function describeEnvIssues(error: z.ZodError): string {
  return error.issues.map((i) => `  ✘ ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n');
}
