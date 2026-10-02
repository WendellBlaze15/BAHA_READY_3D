import { fail, json, route } from '@/lib/api/http';
import { rateLimit } from '@/lib/ratelimit';
import { SURVIVAL_CODE_RE, requireSurvivalPlayer, resolveJoinCode } from '@/lib/survival/server';

export const runtime = 'nodejs';

/** Resolves a 6-character room code to a room id (rate-limited; wrong codes count double). */
export const GET = route(async (_req, ctx: { params: Promise<{ code: string }> }) => {
  const raw = (await ctx.params).code.toUpperCase().replace(/[\s-]/g, '');
  if (!SURVIVAL_CODE_RE.test(raw)) throw fail('VALIDATION_ERROR', 'survival.errors.code_format');
  const { userId } = await requireSurvivalPlayer();
  await rateLimit('survival_join', userId);
  return json({ roomId: await resolveJoinCode(userId, raw) });
});
