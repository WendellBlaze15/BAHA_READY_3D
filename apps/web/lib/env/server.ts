import 'server-only';
import { serverEnvSchema, describeEnvIssues, type ServerEnv } from '@baha/shared/env';

let cached: ServerEnv | undefined;

/** Validated server env. Throws with key names (never values) if anything is missing. */
export function serverEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = serverEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid server environment variables:\n${describeEnvIssues(parsed.error)}`);
  }
  cached = parsed.data;
  return cached;
}
