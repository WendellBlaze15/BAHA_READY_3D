'use client';

import { useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import type { Room } from '@colyseus/sdk';
import { Link } from '@/i18n/navigation';
import { getSupabaseBrowser } from '@/lib/supabase/client';
import { closeKey, errorKey, joinRoom } from '@/lib/survival/client';
import { bus } from '@/game/survival/bus';
import { buzz } from '@/game/survival/native';
import { useRoomState, useSession, type Ping } from '@/game/survival/session-store';
import { LoadingAnnouncement, SkeletonCard } from '@/components/skeletons';
import { Button } from '@/components/ui/button';
import { ChatPanel } from './chat-panel';
import { Cutscene } from './cutscene';
import { Lobby } from './lobby';

const SurvivalGame = dynamic(
  () => import('@/game/survival/SurvivalGame').then((m) => m.SurvivalGame),
  {
    ssr: false,
    loading: () => <div className="bg-storm-slate fixed inset-0 z-50" />,
  },
);

type Msg = Record<string, unknown>;

let pendingLeave: ReturnType<typeof setTimeout> | null = null;
let joining: { roomId: string; p: Promise<Room> } | null = null;

const TONE: Record<string, 'info' | 'good' | 'warn' | 'danger'> = {
  storm_started: 'danger',
  downed: 'danger',
  died: 'danger',
  all_down: 'danger',
  collapse: 'danger',
  storm_damage: 'warn',
  phase_dusk: 'warn',
  fire_out: 'warn',
  heli_incoming: 'good',
  heli_arriving: 'good',
  lifted: 'good',
  boat_stage: 'good',
  camp_level: 'good',
  survivor_rescued: 'good',
  revived: 'good',
  signal_active: 'good',
};

/** Wires every server message into the session store (one place, registered once per room). */
function attach(room: Room, myId: string) {
  const s = useSession.getState();
  const nameOf = (uid: unknown) =>
    (
      room.state as { players?: { get(k: string): { username?: string } | undefined } }
    )?.players?.get(String(uid))?.username ?? '…';
  const on = (type: string, fn: (m: Msg) => void) => room.onMessage(type, fn);

  on('chat:history', (m) => {
    const lines = (m.lines as Msg[]) ?? [];
    useSession.getState().set({
      chat: lines.map((l) => ({
        id: l.id as number,
        senderId: l.senderId as string,
        text: l.text as string,
        status: l.status as 'delivered',
        at: l.at as number,
      })),
    });
  });
  on('chat:message', (m) => {
    s.addChat({
      id: m.id as number,
      senderId: m.senderId as string,
      text: m.text as string,
      status: m.status as 'delivered',
      at: m.at as number,
    });
    bus.bubbles.set(m.senderId as string, { text: m.text as string, at: performance.now() });
  });
  on('chat:rejected', (m) => s.toast({ tone: 'warn', key: `chat.rejected.${m.reasonKey}` }));
  on('chat:muted', (m) => {
    useSession.getState().set({ chatMutedUntil: m.until as number });
    s.toast({
      tone: 'warn',
      key: 'chat.muted',
      params: {
        time: new Date(m.until as number).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        }),
      },
    });
  });
  on('chat:muteState', (m) => {
    const muted = new Set(useSession.getState().muted);
    if (m.muted) muted.add(m.userId as string);
    else muted.delete(m.userId as string);
    useSession.getState().set({ muted });
  });
  on('chat:reported', (m) =>
    s.toast({ tone: m.ok ? 'good' : 'warn', key: m.ok ? 'chat.reported' : 'chat.reportFailed' }),
  );
  on('quickChat', (m) =>
    s.addChat({
      id: `q${m.at}${m.senderId}`,
      senderId: m.senderId as string,
      quick: m.id as number,
      at: m.at as number,
    }),
  );
  on('lobby:error', (m) => s.toast({ tone: 'warn', key: `lobby.reason.${m.reason}` }));
  on('lobby:hostChanged', () => {});
  on('run:starting', () => {});
  on('event', (m) => {
    const kind = String(m.kind);
    const key =
      kind === 'storm_damage'
        ? `event.storm_damage_${m.target}`
        : kind === 'radio'
          ? 'event.radio'
          : `event.${kind}`;
    const params: Record<string, string | number> = {};
    for (const [k, v] of Object.entries(m))
      if (typeof v === 'string' || typeof v === 'number') params[k] = v;
    if (m.userId) params.name = nameOf(m.userId);
    if (m.by) params.by = nameOf(m.by);
    if (m.structure) params.structure = String(m.structure);
    if (kind === 'radio') params.tip = Number(m.tip);
    if (
      (kind === 'downed' || kind === 'lifted' || kind === 'boat_stage') &&
      (m.userId === myId || kind === 'boat_stage')
    )
      void buzz(kind === 'boat_stage' ? 'light' : 'heavy');
    if (kind === 'sleeping' || kind.startsWith('phase_day') || kind === 'phase_dawn') return;
    s.toast({ tone: TONE[kind] ?? 'info', key, params });
    s.addChat({ id: `e${Date.now()}${kind}`, senderId: null, key, params, at: Date.now() });
  });
  on('action:denied', (m) => s.toast({ tone: 'warn', key: `denied.${m.reason}` }));
  on('correction', (m) => {
    bus.correction = {
      x: m.x as number,
      y: m.y as number,
      z: m.z as number,
      reason: String(m.reason),
    };
  });
  on('hazard:warn', (m) => s.toast({ tone: 'warn', key: `hazard.${m.kind}` }));
  on('hazard:hit', (m) => s.toast({ tone: 'danger', key: `hazard.${m.kind}` }));
  on('learning', (m) => s.toast({ tone: m.positive ? 'good' : 'warn', key: `lesson:${m.key}` }));
  on('effect', (m) => {
    if (m.on) s.toast({ tone: 'warn', key: `effect.${m.effect}` });
  });
  on('toast', (m) =>
    s.toast({
      tone: 'info',
      key: `toast:${m.key}`,
      params: m.item ? { item: String(m.item) } : undefined,
    }),
  );
  on('loot:opened', (m) =>
    s.toast({ tone: 'good', key: 'loot', params: { items: JSON.stringify(m.items) } }),
  );
  on('picked', (m) =>
    s.toast({
      tone: 'good',
      key: 'loot',
      params: { items: JSON.stringify([{ item: m.item, qty: m.qty }]) },
    }),
  );
  on('bagFull', () => s.toast({ tone: 'warn', key: 'bag.heavy' }));
  on('give:offer', (m) =>
    useSession.getState().set({ offers: [...useSession.getState().offers, m as never] }),
  );
  on('give:done', () => {});
  on('channel', () => {});
  on('channel:cancelled', () => {});
  on('crafted', () => {});
  on('hit', () => {});
  on('hurt', () => void buzz('light'));
  on('swing', (m) => bus.swings.set(m.userId as string, performance.now()));
  on('emote', (m) =>
    bus.emotes.set(m.userId as string, { id: m.id as string, at: performance.now() }),
  );
  on('ping', (m) => {
    const pings = useSession.getState().pings.filter((p) => p.until > Date.now());
    useSession.getState().set({ pings: [...pings, m as unknown as Ping] });
  });
  on('vote:started', () => {});
  on('vote:ended', (m) =>
    s.toast({ tone: m.passed ? 'good' : 'info', key: m.passed ? 'vote.passed' : 'vote.failed' }),
  );
  on('vote:denied', () => s.toast({ tone: 'warn', key: 'vote.everyoneAtCamp' }));
  on('ended', (m) => useSession.getState().set({ results: m }));
  on('rewardUnlocked', (m) => useSession.getState().set({ rewards: m as never }));
  on('radio:weather', () => {});
  on('storage:open', () => {});
  on('activityFeed', () => {});

  room.onLeave((code) => {
    const key = closeKey(code);
    useSession.getState().set({
      status: 'closed',
      errorKey: key ?? (code === 4000 || code === 1000 ? null : 'connection_lost'),
    });
  });
  room.onDrop(() => useSession.getState().set({ status: 'reconnecting' }));
  room.onReconnect(() => useSession.getState().set({ status: 'connected' }));
  useSession.getState().set({ myId });
}

export function SurvivalSession({ roomId }: { roomId: string }) {
  const t = useTranslations('survival');
  const room = useSession((s) => s.room);
  const status = useSession((s) => s.status);
  const err = useSession((s) => s.errorKey);
  const attached = useRef<Room | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await getSupabaseBrowser().auth.getSession();
      const myId = data.session?.user.id ?? '';
      let r = useSession.getState().room;
      if (!r || r.roomId !== roomId) {
        // One in-flight join per room (a remount must not open a second seat).
        if (!joining || joining.roomId !== roomId) {
          useSession.getState().reset();
          useSession.getState().set({ status: 'connecting', roomId });
          joining = { roomId, p: joinRoom(roomId) };
        }
        try {
          r = await joining.p;
        } catch (e) {
          joining = null;
          if (!cancelled) useSession.getState().set({ status: 'error', errorKey: errorKey(e) });
          return;
        }
        joining = null;
        useSession.getState().set({ room: r, status: 'connected' });
        if (cancelled) return;
      }
      if (attached.current !== r) {
        attach(r, myId);
        attached.current = r;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [roomId]);

  // Leaving the page leaves the session (the server saves; resume any time). Deferred so a
  // remount (React StrictMode, fast navigation back) keeps the same connection.
  useEffect(() => {
    if (pendingLeave) {
      clearTimeout(pendingLeave);
      pendingLeave = null;
    }
    return () => {
      pendingLeave = setTimeout(() => {
        pendingLeave = null;
        const r = useSession.getState().room;
        if (r) void r.leave(true);
        bus.reset();
        useSession.getState().reset();
      }, 400);
    };
  }, []);

  const phase = useRoomState((s) => s.phase as string);

  if (status === 'error' || (status === 'closed' && err)) {
    return (
      <div className="mx-auto max-w-xl space-y-4 px-4 py-10">
        <p role="alert" className="bg-card rounded-lg border p-5 text-lg">
          {t(`errors.${err ?? 'generic'}` as 'errors.generic')}
        </p>
        <Button asChild>
          <Link href="/survival">{t('results.backToHub')}</Link>
        </Button>
      </div>
    );
  }
  if (!room || !phase) {
    return (
      <div className="mx-auto max-w-3xl space-y-3 px-4 py-6">
        <LoadingAnnouncement label={t('waking')} />
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }

  return (
    <>
      {phase === 'lobby' && <Lobby />}
      {phase === 'cutscene' && <Cutscene />}
      {(phase === 'playing' || phase === 'ended') && <SurvivalGame />}
      {phase !== 'cutscene' && <ChatPanel overlay={phase === 'playing' || phase === 'ended'} />}
      {status === 'reconnecting' && (
        <p
          role="status"
          className="bg-signal-amber text-storm-slate fixed top-2 left-1/2 z-[70] -translate-x-1/2 rounded-full px-4 py-1 text-sm font-semibold"
        >
          {t('errors.connection_lost')}
        </p>
      )}
    </>
  );
}
