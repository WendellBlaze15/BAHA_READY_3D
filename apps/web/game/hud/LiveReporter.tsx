'use client';

import { useEffect, useMemo } from 'react';
import { useLiveChannel, type LivePhase } from '@/lib/realtime/live';
import { useGame } from '../store/game-store';

/** Reports this player's phase to the facilitator's live board via Presence. */
export function LiveReporter({
  sessionId,
  me,
  stars,
}: {
  sessionId: string;
  me: { id: string; username: string };
  stars?: number;
}) {
  const phase = useGame((s) => s.phase);
  const presence = useMemo(
    () => ({ user_id: me.id, username: me.username, phase: 'lobby' as LivePhase }),
    [me],
  );
  const { update } = useLiveChannel(sessionId, presence);
  useEffect(() => {
    const p: LivePhase =
      phase === 'prep' ? 'prep' : phase === 'evac' ? 'evac' : phase === 'ended' ? 'done' : 'lobby';
    update({ phase: p, ...(p === 'done' && typeof stars === 'number' ? { stars } : {}) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, stars]);
  return null;
}
