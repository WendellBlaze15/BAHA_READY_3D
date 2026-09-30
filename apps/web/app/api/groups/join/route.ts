import { z } from 'zod';
import { assertSameOrigin, fail, json, parseBody, route } from '@/lib/api/http';
import { rateLimit } from '@/lib/ratelimit';
import { requireUser } from '@/lib/auth/session';

export const runtime = 'nodejs';

const schema = z
  .object({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z2-9]{6}$/, 'errors.join_code'),
  })
  .strict();

/** Rate-limited wrapper around the join_group RPC (10/hour per user). */
export const POST = route(async (req) => {
  assertSameOrigin(req);
  const { supabase, userId } = await requireUser({ onboarded: true, permission: 'groups.join' });
  await rateLimit('join_group', userId);
  const { code } = await parseBody(req, schema);
  const { data, error } = await supabase.rpc('join_group', { code });
  if (error) {
    if (error.message.includes('NOT_FOUND')) throw fail('NOT_FOUND', 'errors.join_code');
    if (error.message.includes('CONFLICT')) throw fail('CONFLICT', 'errors.group_full');
    if (error.message.includes('FORBIDDEN')) throw fail('FORBIDDEN', 'errors.forbidden');
    throw fail('INTERNAL', 'errors.internal');
  }
  return json(data as { group_id: string; status: 'active' | 'pending'; already: boolean });
});
