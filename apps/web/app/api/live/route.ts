import { z } from 'zod';
import { assertSameOrigin, fail, json, parseBody, route } from '@/lib/api/http';
import { rateLimit } from '@/lib/ratelimit';
import { requireUser } from '@/lib/auth/session';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { publicEnv } from '@/lib/env/client';
import { serverEnv } from '@/lib/env/server';

export const runtime = 'nodejs';

const schema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('create'),
      group_id: z.uuid(),
      level_id: z.number().int().min(0).max(99),
    })
    .strict(),
  z.object({ action: z.literal('start'), session_id: z.uuid() }).strict(),
  z.object({ action: z.literal('end'), session_id: z.uuid() }).strict(),
]);

async function broadcast(topic: string, event: string, payload: Record<string, unknown>) {
  const key = serverEnv().SUPABASE_SERVICE_ROLE_KEY;
  await fetch(`${publicEnv.NEXT_PUBLIC_SUPABASE_URL}/realtime/v1/api/broadcast`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ topic, event, payload, private: true }] }),
  }).catch(() => undefined);
}

/** Live drill sessions: create (lobby) → start (broadcast to every member) → end (summary). */
export const POST = route(async (req) => {
  assertSameOrigin(req);
  const { supabase, userId } = await requireUser({ permission: 'groups.manage' });
  await rateLimit('content_write', userId);
  const body = await parseBody(req, schema);

  if (body.action === 'create') {
    // RLS: only the group's owner (with MFA) can create sessions.
    const { data, error } = await supabase
      .from('live_sessions')
      .insert({
        group_id: body.group_id,
        level_id: body.level_id,
        code: 'AAAAAA',
        created_by: userId,
      })
      .select('id, code, status, level_id, group_id')
      .single();
    if (error || !data) throw fail('FORBIDDEN', 'errors.forbidden');
    // Tell members a session is open (group channel).
    await broadcast(`group:${body.group_id}`, 'live_session_open', { session_id: data.id });
    return json(data);
  }

  const { data: session } = await supabase
    .from('live_sessions')
    .select('id, group_id, level_id, status')
    .eq('id', body.session_id)
    .maybeSingle();
  if (!session) throw fail('NOT_FOUND', 'errors.not_found');

  if (body.action === 'start') {
    const { data: level } = await supabase
      .from('levels')
      .select('slug')
      .eq('id', session.level_id)
      .single();
    await supabase
      .from('live_sessions')
      .update({ status: 'running', started_at: new Date().toISOString() })
      .eq('id', session.id);
    await broadcast(`live:${session.id}`, 'start', { slug: level?.slug, session_id: session.id });
    return json({ status: 'running' });
  }

  await supabase
    .from('live_sessions')
    .update({ status: 'ended', ended_at: new Date().toISOString() })
    .eq('id', session.id);
  const { data: attempts } = await getSupabaseAdmin()
    .from('attempts')
    .select('status, stars, score')
    .eq('live_session_id', session.id)
    .neq('status', 'in_progress');
  const summary = {
    finished: attempts?.length ?? 0,
    survived: attempts?.filter((a) => a.status === 'completed').length ?? 0,
    avg_score: attempts?.length
      ? Math.round(attempts.reduce((s, a) => s + (a.score ?? 0), 0) / attempts.length)
      : 0,
  };
  await broadcast(`live:${session.id}`, 'end', summary);
  return json({ status: 'ended', summary });
});
