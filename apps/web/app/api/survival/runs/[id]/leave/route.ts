import { z } from 'zod';
import { assertSameOrigin, fail, json, route } from '@/lib/api/http';
import { rateLimit } from '@/lib/ratelimit';
import { gameServer, requireSurvivalPlayer } from '@/lib/survival/server';

export const runtime = 'nodejs';

/** "Umalis sa Team": leave a run for good (bag goes to camp storage, host passes on). */
export const POST = route(async (req, ctx: { params: Promise<{ id: string }> }) => {
  assertSameOrigin(req);
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) throw fail('VALIDATION_ERROR', 'errors.validation');
  const { userId } = await requireSurvivalPlayer();
  await rateLimit('survival_leave', userId);
  await gameServer<{ ok: boolean }>(`/internal/runs/${id}/leave`, { userId });
  return json({ ok: true });
});
