import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

export type PlayContext = {
  mode: 'normal' | 'daily' | 'live' | 'assignment';
  liveSessionId?: string;
  assignmentId?: string;
};

const UUID = /^[0-9a-f-]{36}$/;

/** Parses ?mode=…&session=…&assignment=… from the play URL (ignores anything malformed). */
export function parsePlayContext(q: {
  mode?: string;
  session?: string;
  assignment?: string;
}): PlayContext {
  if (q.mode === 'live' && q.session && UUID.test(q.session))
    return { mode: 'live', liveSessionId: q.session };
  if (q.mode === 'assignment' && q.assignment && UUID.test(q.assignment))
    return { mode: 'assignment', assignmentId: q.assignment };
  if (q.mode === 'daily') return { mode: 'daily' };
  return { mode: 'normal' };
}

/**
 * Mirrors start-attempt's rule (the server re-checks it): a not-yet-unlocked level can be
 * played for today's daily challenge, an open live session of the player's group, or an
 * assignment from one of the player's groups that includes the level. Uses the player's own
 * session, so RLS already limits it to their groups.
 */
export async function unlockedByContext(
  supabase: SupabaseClient,
  uid: string,
  levelId: number,
  ctx: PlayContext,
) {
  if (ctx.mode === 'daily') {
    const today = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
    const { data } = await supabase
      .from('daily_challenges')
      .select('level_id')
      .eq('date', today)
      .maybeSingle();
    return data?.level_id === levelId;
  }
  const activeMember = async (groupId: string) => {
    const { data } = await supabase
      .from('group_members')
      .select('status')
      .eq('group_id', groupId)
      .eq('user_id', uid)
      .maybeSingle();
    return data?.status === 'active';
  };
  if (ctx.mode === 'live' && ctx.liveSessionId) {
    const { data } = await supabase
      .from('live_sessions')
      .select('group_id, level_id, status')
      .eq('id', ctx.liveSessionId)
      .maybeSingle();
    return (
      !!data &&
      data.level_id === levelId &&
      data.status !== 'ended' &&
      (await activeMember(data.group_id))
    );
  }
  if (ctx.mode === 'assignment' && ctx.assignmentId) {
    const { data } = await supabase
      .from('assignments')
      .select('group_id, level_ids')
      .eq('id', ctx.assignmentId)
      .maybeSingle();
    return (
      !!data &&
      (data.level_ids as number[]).includes(levelId) &&
      (await activeMember(data.group_id))
    );
  }
  return false;
}
