import { z } from 'zod';
import { assertSameOrigin, fail, json, parseBody, route } from '@/lib/api/http';
import { rateLimit } from '@/lib/ratelimit';
import { requireSurvivalPlayer } from '@/lib/survival/server';

export const runtime = 'nodejs';

const schema = z.object({ userId: z.uuid() }).strict();

/**
 * Block / unblock a player (Section 17.5): never placed in the same room again, and their chat
 * is hidden for you. RLS lets players manage only their own blocks.
 */
async function handle(req: Request, on: boolean) {
  assertSameOrigin(req);
  const { supabase, userId } = await requireSurvivalPlayer();
  await rateLimit('survival_block', userId);
  const { userId: target } = await parseBody(req, schema);
  if (target === userId) throw fail('VALIDATION_ERROR', 'errors.validation');
  const { error } = on
    ? await supabase.from('survival_blocks').upsert({ blocker_id: userId, blocked_id: target })
    : await supabase
        .from('survival_blocks')
        .delete()
        .eq('blocker_id', userId)
        .eq('blocked_id', target);
  if (error) throw fail('FORBIDDEN', 'errors.forbidden');
  return json({ ok: true, blocked: on });
}

export const POST = route((req) => handle(req, true));
export const DELETE = route((req) => handle(req, false));
