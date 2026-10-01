import { z } from 'zod';

/**
 * Game-server environment, validated once at boot. Values are never logged; on failure only
 * the offending variable NAMES are printed.
 */
const csv = z.string().transform((s) =>
  s
    .split(',')
    .map((v) => v.trim().replace(/\/+$/, ''))
    .filter(Boolean),
);

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(2567),
    SUPABASE_URL: z.url(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
    /** Defaults to `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`. */
    SUPABASE_JWKS_URL: z.url().optional(),
    UPSTASH_REDIS_REST_URL: z.url().optional(),
    UPSTASH_REDIS_REST_TOKEN: z.string().min(10).optional(),
    /** Comma-separated web origins allowed to open game connections. */
    ALLOWED_ORIGINS: csv.default([]),
    GAME_SERVER_ADMIN_SECRET: z.string().min(32),
    SENTRY_DSN: z.url().optional(),
    /** Railway sets this; used for log context only. */
    RAILWAY_REPLICA_ID: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;
    if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN)
      ctx.addIssue({
        code: 'custom',
        path: ['UPSTASH_REDIS_REST_URL'],
        message: 'required in production',
      });
    if (env.ALLOWED_ORIGINS.length === 0)
      ctx.addIssue({
        code: 'custom',
        path: ['ALLOWED_ORIGINS'],
        message: 'required in production',
      });
  });

export type Env = z.infer<typeof schema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const r = schema.safeParse({
    ...source,
    // Local dev reuses the web app's public URL.
    SUPABASE_URL: source.SUPABASE_URL ?? source.NEXT_PUBLIC_SUPABASE_URL,
  });
  if (!r.success) {
    const names = [...new Set(r.error.issues.map((i) => i.path.join('.')))];
    throw new Error(`Invalid game-server environment: ${names.join(', ')}`);
  }
  const env = r.data;
  if (env.NODE_ENV !== 'production') {
    // Dev convenience: the local web app and the Capacitor shell.
    env.ALLOWED_ORIGINS = [
      ...new Set([...env.ALLOWED_ORIGINS, 'http://localhost:3000', 'http://127.0.0.1:3000']),
    ];
  }
  return env;
}

/** Native app WebViews (Capacitor) report these origins. */
export const NATIVE_ORIGINS = ['capacitor://localhost', 'https://localhost', 'http://localhost'];
