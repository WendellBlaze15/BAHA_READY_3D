import { z } from 'zod';
import { assertSameOrigin, fail, json, parseBody, route } from '@/lib/api/http';
import { requireStaff } from '@/lib/auth/staff';

export const runtime = 'nodejs';

const schema = z.object({ action: z.literal('revoke') }).strict();

/** Revoke a chat/Survival restriction early (audited by trigger). */
export const POST = route<{ params: Promise<{ id: string }> }>(async (req, ctx) => {
  assertSameOrigin(req);
  const { supabase, userId } = await requireStaff('survival.reports.review');
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) throw fail('NOT_FOUND', 'errors.not_found');
  await parseBody(req, schema);
  const { data, error } = await supabase
    .from('survival_restrictions')
    .update({ revoked_at: new Date().toISOString(), revoked_by: userId })
    .eq('id', id)
    .is('revoked_at', null)
    .select('id');
  if (error || !data?.length) throw fail('NOT_FOUND', 'errors.not_found');
  return json({ ok: true });
});
