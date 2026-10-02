import { z } from 'zod';
import { survivalConfigSchema } from '@baha/shared/survival';
import { assertSameOrigin, fail, json, parseBody, route } from '@/lib/api/http';
import { requireStaff } from '@/lib/auth/staff';
import { rateLimit } from '@/lib/ratelimit';

export const runtime = 'nodejs';

const body = z.object({ config: z.unknown(), notes: z.string().trim().min(3).max(500) }).strict();

/**
 * Publish a new Survival config version (validated with the shared Zod schema, including all
 * cross-references). Running runs keep their pinned version. Audited by trigger.
 */
export const POST = route(async (req) => {
  assertSameOrigin(req);
  const { supabase, userId } = await requireStaff('survival.config.manage');
  await rateLimit('content_write', userId);
  const { config, notes } = await parseBody(req, body);
  const parsed = survivalConfigSchema.safeParse(config);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const i of parsed.error.issues.slice(0, 20)) fields[i.path.join('.') || '_'] = i.message;
    throw fail('VALIDATION_ERROR', 'errors.validation', { fields });
  }
  const { data, error } = await supabase.rpc('publish_survival_config', {
    p_config: parsed.data,
    p_notes: notes,
  });
  if (error) throw fail(error.code === '42501' ? 'FORBIDDEN' : 'INTERNAL', 'errors.generic');
  return json({ version: data as number });
});
