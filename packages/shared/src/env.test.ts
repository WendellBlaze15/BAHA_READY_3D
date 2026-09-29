import { describe, expect, it } from 'vitest';
import { describeEnvIssues, serverEnvSchema, SERVER_ONLY_KEYS } from './env.ts';

describe('env schemas', () => {
  it('reports missing keys by name without leaking values', () => {
    const result = serverEnvSchema.safeParse({ BREVO_API_KEY: 'not-a-brevo-key-super-secret' });
    expect(result.success).toBe(false);
    const msg = describeEnvIssues(result.error!);
    expect(msg).toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(msg).toContain('BREVO_API_KEY');
    expect(msg).not.toContain('super-secret');
  });

  it('lists service role key as server-only', () => {
    expect(SERVER_ONLY_KEYS).toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(SERVER_ONLY_KEYS.some((k) => k.startsWith('NEXT_PUBLIC_'))).toBe(false);
  });
});
