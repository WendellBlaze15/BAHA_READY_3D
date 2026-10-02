import { z } from 'zod';
import { assertSameOrigin, fail, json, route } from '@/lib/api/http';
import { rateLimit } from '@/lib/ratelimit';
import { gameServer, requireSurvivalPlayer } from '@/lib/survival/server';

export const runtime = 'nodejs';

/** "Ituloy ang Laro": the game server opens (or returns) the run's live session room. */
export const POST = route(async (req, ctx: { params: Promise<{ id: string }> }) => {
  assertSameOrigin(req);
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) throw fail('VALIDATION_ERROR', 'errors.validation');
  const { userId } = await requireSurvivalPlayer();
  await rateLimit('survival_resume', userId);
  const r = await gameServer<{ roomId: string; created: boolean }>(`/internal/runs/${id}/resume`, {
    userId,
  });
  return json({ roomId: r.roomId, created: r.created });
});
