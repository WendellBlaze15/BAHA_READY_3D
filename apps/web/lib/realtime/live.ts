'use client';

import { useEffect, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { getSupabaseBrowser } from '@/lib/supabase/client';

export type LivePhase = 'lobby' | 'prep' | 'evac' | 'done';
export type LivePresence = {
  user_id: string;
  username: string;
  phase: LivePhase;
  stars?: number;
  facilitator?: boolean;
};

/**
 * Private `live:<session>` channel: Presence (who's here + their phase) and Broadcast
 * (start/end from the server). Realtime Authorization limits it to group members/owner.
 */
export function useLiveChannel(
  sessionId: string | null,
  me: LivePresence | null,
  handlers: {
    onStart?: (p: { slug: string }) => void;
    onEnd?: (s: Record<string, number>) => void;
  } = {},
) {
  const [players, setPlayers] = useState<LivePresence[]>([]);
  const channel = useRef<RealtimeChannel | null>(null);
  const h = useRef(handlers);
  h.current = handlers;

  useEffect(() => {
    if (!sessionId || !me) return;
    const sb = getSupabaseBrowser();
    const ch = sb.channel(`live:${sessionId}`, {
      config: { private: true, presence: { key: me.user_id } },
    });
    ch.on('presence', { event: 'sync' }, () => {
      const state = ch.presenceState<LivePresence>();
      setPlayers(
        Object.values(state)
          .map((arr) => arr[arr.length - 1]!)
          .filter((p) => !p.facilitator),
      );
    })
      .on('broadcast', { event: 'start' }, ({ payload }) =>
        h.current.onStart?.(payload as { slug: string }),
      )
      .on('broadcast', { event: 'end' }, ({ payload }) =>
        h.current.onEnd?.(payload as Record<string, number>),
      )
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') await ch.track(me);
      });
    channel.current = ch;
    return () => {
      void sb.removeChannel(ch);
      channel.current = null;
    };
    // Re-subscribe only when identity/session changes; phase updates go through update().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, me?.user_id]);

  const update = (patch: Partial<LivePresence>) => {
    if (channel.current && me) void channel.current.track({ ...me, ...patch });
  };
  return { players, update };
}
