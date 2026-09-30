import { z } from 'zod';
import { assertSameOrigin, fail, json, parseBody, route } from '@/lib/api/http';
import { rateLimit } from '@/lib/ratelimit';
import { requireStaff } from '@/lib/auth/staff';

export const runtime = 'nodejs';

const schema = z
  .object({ action: z.enum(['void', 'restore']), reason: z.string().trim().min(3).max(500) })
  .strict();

/** Void or restore a flagged score (reason required). Leaderboards update on the next refresh. */
export const POST = route<{ params: Promise<{ id: string }> }>(async (req, ctx) => {
  assertSameOrigin(req);
  const { supabase, userId } = await requireStaff('leaderboard.moderate');
  await rateLimit('content_write', userId);
  const { id } = await ctx.params;
  const { action, reason } = await parseBody(req, schema);
  const { error } = await supabase.rpc('moderate_attempt', {
    p_attempt_id: id,
    p_action: action,
    p_reason: reason,
  });
  if (error)
    throw fail(error.message.includes('NOT_FOUND') ? 'NOT_FOUND' : 'FORBIDDEN', 'errors.forbidden');
  return json({ ok: true });
});

/** Event log for the moderation timeline. */
export const GET = route<{ params: Promise<{ id: string }> }>(async (_req, ctx) => {
  const { supabase } = await requireStaff('leaderboard.moderate');
  const { id } = await ctx.params;
  const { data } = await supabase
    .from('attempt_events')
    .select('events')
    .eq('attempt_id', id)
    .maybeSingle();
  return json({ events: data?.events ?? [] });
});
