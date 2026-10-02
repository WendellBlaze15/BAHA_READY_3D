import { z } from 'zod';
import { assertSameOrigin, fail, json, parseBody, route } from '@/lib/api/http';
import { requireStaff } from '@/lib/auth/staff';
import { consumeReauth } from '@/lib/auth/reauth';

export const runtime = 'nodejs';

const schema = z
  .object({
    enabled: z.boolean(),
    message: z
      .object({ fil: z.string().trim().min(3).max(200), en: z.string().trim().min(3).max(200) })
      .strict()
      .optional(),
  })
  .strict();

/**
 * Survival kill switch (super admin + fresh re-auth). Running sessions get a 5-minute warning,
 * then save and close; lobbies close right away. Audited via the system_settings trigger.
 */
export const POST = route(async (req) => {
  assertSameOrigin(req);
  const { supabase, userId } = await requireStaff('survival.system.toggle');
  await consumeReauth(userId);
  const body = await parseBody(req, schema);
  const { error } = await supabase
    .from('system_settings')
    .update({ value: body.enabled })
    .eq('key', 'survival_enabled');
  if (error) throw fail('FORBIDDEN', 'errors.forbidden');
  if (body.message) {
    await supabase
      .from('system_settings')
      .update({ value: body.message })
      .eq('key', 'survival_disabled_message');
  }
  return json({ ok: true });
});
