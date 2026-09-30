import { z } from 'zod';
import { clientIp, fail, json, route } from '@/lib/api/http';
import { rateLimit } from '@/lib/ratelimit';
import { getSupabaseServer } from '@/lib/supabase/server';

export const runtime = 'nodejs';

const query = z
  .object({
    scope: z.enum(['global', 'level', 'barangay', 'group']).default('global'),
    period: z.enum(['weekly', 'all_time', 'daily']).default('weekly'),
    level: z.coerce.number().int().min(0).max(99).optional(),
    group: z.uuid().optional(),
    cursor: z.coerce.number().int().min(0).max(100000).default(0),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();

/** Rate-limited leaderboard read (60/min per user or IP). RLS-safe RPC underneath. */
export const GET = route(async (req) => {
  const params = Object.fromEntries(new URL(req.url).searchParams);
  const parsed = query.safeParse(params);
  if (!parsed.success) throw fail('VALIDATION_ERROR', 'errors.validation');
  const q = parsed.data;

  const supabase = await getSupabaseServer();
  const { data: claims } = await supabase.auth.getClaims();
  const uid = claims?.claims.sub;
  await rateLimit('leaderboard_read', uid ?? clientIp(req));
  if ((q.scope === 'barangay' || q.scope === 'group') && !uid)
    throw fail('UNAUTHENTICATED', 'errors.unauthenticated');

  const args = {
    p_scope: q.scope,
    p_period: q.period,
    p_level_id: q.scope === 'level' ? (q.level ?? 1) : undefined,
    p_group_id: q.scope === 'group' ? q.group : undefined,
    p_cursor: q.cursor,
    p_limit: q.limit,
  };
  const [{ data: rows, error }, me] = await Promise.all([
    supabase.rpc('get_leaderboard', args),
    uid && q.cursor === 0
      ? supabase.rpc('get_leaderboard', { ...args, p_cursor: 0, p_only_me: true })
      : Promise.resolve({ data: null }),
  ]);
  if (error) {
    if (error.message.includes('FORBIDDEN')) throw fail('FORBIDDEN', 'errors.forbidden');
    throw fail('INTERNAL', 'errors.internal');
  }
  const list = rows ?? [];
  return json({
    rows: list,
    me: (me.data as typeof list | null)?.[0] ?? null,
    nextCursor: list.length === q.limit ? Number(list[list.length - 1]!.rank) : null,
  });
});
