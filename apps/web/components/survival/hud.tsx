'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Anchor,
  ArrowBigUp,
  Axe,
  Backpack,
  CloudLightning,
  CloudRain,
  Droplet,
  Flame,
  Hammer,
  Heart,
  Map as MapIcon,
  Menu,
  Moon,
  Sun,
  Thermometer,
  Utensils,
  Wind,
  Zap,
} from 'lucide-react';
import { Joystick } from '@/game/hud/Joystick';
import { inputActions } from '@/game/systems/input';
import { isMobileDevice } from '@/game/systems/quality';
import { interactWith, useTarget } from '@/game/survival/LocalPlayer';
import { useRoomState, useSession } from '@/game/survival/session-store';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useSurvivalText } from './use-text';

const fmtTime = (minute: number) => {
  const h = Math.floor(minute / 60) % 24;
  const m = Math.floor(minute % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

function Bar({
  value,
  label,
  icon: Icon,
  color,
  low = 25,
}: {
  value: number;
  label: string;
  icon: typeof Heart;
  color: string;
  low?: number;
}) {
  return (
    <div className="flex items-center gap-1.5" title={label}>
      <Icon
        className={cn('size-4 shrink-0', value <= low && 'animate-pulse text-red-400')}
        aria-hidden
      />
      <div
        className="h-2.5 w-16 overflow-hidden rounded-full bg-black/40 sm:w-24"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
      >
        <div
          className={cn('h-full rounded-full transition-[width] duration-300', color)}
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  );
}

export function SurvivalHud() {
  const t = useTranslations('survival');
  const { text, item } = useSurvivalText();
  const myId = useSession((s) => s.myId);
  const toasts = useSession((s) => s.toasts);
  const offers = useSession((s) => s.offers);
  const room = useSession((s) => s.room);
  const target = useTarget((s) => s.target);
  const v = useRoomState((s) => {
    const me = myId ? s.players?.get?.(myId) : undefined;
    return {
      day: s.day as number,
      minute: s.minute as number,
      dayPhase: s.dayPhase as string,
      weather: s.weather as string,
      paused: s.paused as boolean,
      mode: s.mode as string,
      simTime: s.simTime as number,
      boatStage: s.boat?.stage as number,
      boatProgress: s.boat?.progress as number,
      campLevel: s.camp?.level as number,
      fireLit: s.camp?.fireLit as boolean,
      secondWinds: s.secondWindsLeft as number,
      heli: s.heli as string,
      vote: s.voteType
        ? {
            type: s.voteType as string,
            target: s.voteTarget as string,
            yes: s.voteYes as number,
            needed: s.voteNeeded as number,
          }
        : null,
      me: me && {
        health: me.health,
        hunger: me.hunger,
        thirst: me.thirst,
        warmth: me.warmth,
        energy: me.energy,
        stamina: me.stamina,
        hingal: me.hingal,
        effects: String(me.effects ?? '')
          .split(',')
          .filter(Boolean) as string[],
        life: me.life as string,
        spectator: me.spectator as boolean,
        rescued: me.rescued as boolean,
        channel: me.channel as string,
        channelEndsAt: me.channelEndsAt as number,
        bleedOutAt: me.bleedOutAt as number,
        role: me.role as string,
      },
      names: Object.fromEntries(
        (() => {
          const out: [string, string][] = [];
          s.players?.forEach?.((p: { username: string }, k: string) => out.push([k, p.username]));
          return out;
        })(),
      ) as Record<string, string>,
    };
  }, 8);
  // Touch controls for phones/tablets (incl. iPads that report a desktop user agent).
  const mobile =
    typeof window !== 'undefined' &&
    (isMobileDevice() || !!window.matchMedia?.('(pointer: coarse)').matches);
  const wasHingal = useRef(false);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    if (!v?.me) return;
    if (wasHingal.current && !v.me.hingal) {
      setFlash(true);
      setTimeout(() => setFlash(false), 1200);
    }
    wasHingal.current = !!v.me.hingal;
  }, [v?.me?.hingal, v?.me]);

  if (!v?.me || !room) return null;
  const me = v.me;
  const night = v.dayPhase === 'night' || v.dayPhase === 'dusk';
  const promptLabel = target
    ? target.kind === 'drop'
      ? t('hud.prompt.pickup', { item: item(target.item) })
      : target.kind === 'revive'
        ? t('hud.prompt.revive', { name: target.name })
        : target.kind === 'boat'
          ? t('hud.prompt.buildBoat')
          : t(`hud.prompt.${target.kind}` as 'hud.prompt.loot')
    : null;
  const channelLeft =
    me.channel && me.channelEndsAt > 0 ? Math.max(0, me.channelEndsAt - v.simTime) : null;
  const bleed = me.life === 'downed' ? Math.max(0, Math.ceil(me.bleedOutAt - v.simTime)) : 0;

  return (
    <div
      className="pointer-events-none fixed inset-0 z-[55] text-white select-none"
      style={{ height: '100dvh' }}
    >
      {/* Top-left: day, time, weather, boat */}
      <div className="pointer-events-auto absolute top-[max(0.5rem,env(safe-area-inset-top))] left-[max(0.5rem,env(safe-area-inset-left))] space-y-1 rounded-lg bg-black/45 p-2 text-sm backdrop-blur-sm">
        <p className="flex items-center gap-1.5 font-semibold">
          {night ? <Moon className="size-4" aria-hidden /> : <Sun className="size-4" aria-hidden />}
          {t('hud.time', { day: v.day, time: fmtTime(v.minute) })}
          <span className="font-normal opacity-80">
            · {t(`hud.weather.${v.weather}` as 'hud.weather.clear')}
          </span>
          {v.weather === 'storm' ? (
            <CloudLightning className="size-4" aria-hidden />
          ) : v.weather === 'rain' ? (
            <CloudRain className="size-4" aria-hidden />
          ) : null}
        </p>
        <button
          type="button"
          className="flex w-full items-center gap-1.5 text-left"
          onClick={() => useSession.getState().set({ panel: 'boat' })}
          aria-label={t('boat.title')}
        >
          <Anchor className="size-4" aria-hidden />
          <span>
            {t('hud.boat')} {v.boatStage}/6
          </span>
          <span className="h-1.5 w-16 overflow-hidden rounded-full bg-black/40">
            <span
              className="block h-full bg-sky-400"
              style={{ width: `${Math.round((v.boatProgress ?? 0) * 100)}%` }}
            />
          </span>
        </button>
        <p className="flex items-center gap-1.5 text-xs opacity-90">
          {t('hud.camp', { level: v.campLevel ?? 1 })}
          {v.fireLit && <Flame className="size-3.5 text-orange-400" aria-label={t('hud.fire')} />}
        </p>
      </div>

      {/* Top-right: menu (chat button is rendered by ChatPanel) */}
      <div className="pointer-events-auto absolute top-[max(0.5rem,env(safe-area-inset-top))] right-[max(5.5rem,calc(env(safe-area-inset-right)+5rem))] flex gap-2 sm:right-40">
        <Button
          size="icon-lg"
          variant="secondary"
          aria-label={t('hud.menu')}
          onClick={() => useSession.getState().set({ panel: 'menu' })}
        >
          <Menu aria-hidden />
        </Button>
      </div>

      {/* Toasts */}
      <div
        className="absolute top-20 left-1/2 w-[min(92vw,30rem)] -translate-x-1/2 space-y-1.5"
        aria-live="polite"
      >
        {toasts.map((x) => {
          const msg = text(x.key, x.params);
          if (!msg) return null;
          return (
            <p
              key={x.id}
              className={cn(
                'rounded-lg px-3 py-2 text-center text-sm font-medium shadow-lg backdrop-blur-sm',
                x.tone === 'danger'
                  ? 'bg-red-700/90'
                  : x.tone === 'warn'
                    ? 'bg-amber-600/90'
                    : x.tone === 'good'
                      ? 'bg-emerald-700/90'
                      : 'bg-slate-800/90',
              )}
            >
              {msg}
            </p>
          );
        })}
      </div>

      {/* Vote banner */}
      {v.vote && (
        <div className="pointer-events-auto absolute top-36 left-1/2 flex -translate-x-1/2 flex-wrap items-center gap-2 rounded-lg bg-slate-900/90 p-2 text-sm">
          <span>
            {t('vote.started', {
              what:
                v.vote.type === 'kick'
                  ? t('vote.kick', { name: v.names[v.vote.target] ?? '…' })
                  : t(`vote.${v.vote.type}` as 'vote.rest'),
            })}{' '}
            ({v.vote.yes}/{v.vote.needed})
          </span>
          {v.vote.target !== myId && (
            <>
              <Button
                size="sm"
                onClick={() =>
                  room.send('vote', {
                    type: v.vote!.type,
                    targetUserId: v.vote!.target || undefined,
                    value: true,
                  })
                }
              >
                {t('vote.yes')}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() =>
                  room.send('vote', {
                    type: v.vote!.type,
                    targetUserId: v.vote!.target || undefined,
                    value: false,
                  })
                }
              >
                {t('vote.no')}
              </Button>
            </>
          )}
        </div>
      )}

      {/* Give offers */}
      {offers.slice(-1).map((o) => (
        <div
          key={o.offerId}
          className="pointer-events-auto absolute top-48 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-lg bg-slate-900/90 p-2 text-sm"
        >
          <span>
            {v.names[o.fromUserId] ?? '…'} → {o.qty}× {item(o.item)}
          </span>
          <Button
            size="sm"
            onClick={() => {
              room.send('give:accept', { offerId: o.offerId });
              useSession.getState().set({ offers: [] });
            }}
          >
            {t('vote.yes')}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => useSession.getState().set({ offers: [] })}
          >
            {t('vote.no')}
          </Button>
        </div>
      ))}

      {/* Hold progress */}
      {channelLeft !== null && channelLeft >= 0 && me.channelEndsAt !== -1 && (
        <p
          className="absolute top-1/2 left-1/2 -translate-x-1/2 translate-y-10 rounded-full bg-black/60 px-4 py-1 text-sm"
          role="status"
        >
          {t(`hud.channel.${me.channel}` as 'hud.channel.loot')} {channelLeft.toFixed(1)}s
        </p>
      )}
      {me.channel === 'build' && me.channelEndsAt === -1 && (
        <p
          className="absolute top-1/2 left-1/2 -translate-x-1/2 translate-y-10 rounded-full bg-black/60 px-4 py-1 text-sm"
          role="status"
        >
          {t('hud.channel.build')}
        </p>
      )}

      {/* Life-state overlays */}
      {me.life === 'downed' && (
        <div
          className="absolute inset-x-0 top-1/3 mx-auto w-fit rounded-xl bg-red-900/85 p-4 text-center"
          role="alert"
        >
          <p className="text-lg font-bold">{t('hud.downed')}</p>
          <p>{t('hud.bleedOut', { seconds: bleed })}</p>
          {v.mode === 'solo' && v.secondWinds > 0 && (
            <Button
              className="pointer-events-auto mt-2"
              onClick={() => room.send('revive', { targetUserId: myId })}
            >
              {t('hud.secondWind', { left: v.secondWinds })}
            </Button>
          )}
        </div>
      )}
      {me.life === 'dead' && (
        <p
          className="absolute inset-x-0 top-1/3 mx-auto w-fit rounded-xl bg-slate-900/85 p-4 text-center text-lg"
          role="status"
        >
          {me.spectator ? t('hud.spectating') : t('hud.dead')}
        </p>
      )}
      {me.rescued && (
        <p
          className="absolute inset-x-0 top-1/3 mx-auto w-fit rounded-xl bg-emerald-800/85 p-4 text-center text-lg"
          role="status"
        >
          {t('hud.rescued')}
        </p>
      )}
      {v.paused && (
        <div className="absolute inset-0 grid place-items-center bg-black/50">
          <Button
            size="lg"
            className="pointer-events-auto"
            onClick={() => room.send('pause', { paused: false })}
          >
            {t('hud.resume')}
          </Button>
        </div>
      )}

      {/* Bottom-left: stats (+ joystick on touch) */}
      <div className="absolute bottom-[max(0.5rem,env(safe-area-inset-bottom))] left-[max(0.5rem,env(safe-area-inset-left))] space-y-1 rounded-lg bg-black/45 p-2 text-xs backdrop-blur-sm">
        <Bar value={me.health} label={t('hud.stat.health')} icon={Heart} color="bg-red-500" />
        <Bar value={me.hunger} label={t('hud.stat.hunger')} icon={Utensils} color="bg-amber-500" />
        <Bar value={me.thirst} label={t('hud.stat.thirst')} icon={Droplet} color="bg-sky-400" />
        <Bar
          value={me.warmth}
          label={t('hud.stat.warmth')}
          icon={Thermometer}
          color="bg-orange-400"
        />
        <Bar value={me.energy} label={t('hud.stat.energy')} icon={Zap} color="bg-lime-400" />
        <div className="flex items-center gap-1.5" title={t('hud.stat.stamina')}>
          <Wind className={cn('size-4', me.hingal && 'text-amber-300')} aria-hidden />
          <div
            className="relative h-2.5 w-16 overflow-hidden rounded-full bg-black/40 sm:w-24"
            role="meter"
            aria-label={t('hud.stat.stamina')}
            aria-valuenow={me.stamina}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className={cn(
                'h-full rounded-full',
                me.hingal
                  ? 'bg-[repeating-linear-gradient(45deg,#9e9e9e_0_4px,#616161_4px_8px)]'
                  : 'bg-emerald-400',
              )}
              style={{ width: `${me.stamina}%` }}
            />
          </div>
          {me.hingal && (
            <span className="rounded bg-amber-500/90 px-1 text-[10px] font-bold text-black">
              {t('hud.hingal')}
            </span>
          )}
          {flash && (
            <span className="rounded bg-emerald-500/90 px-1 text-[10px] font-bold text-black">
              {t('hud.sprintReady')}
            </span>
          )}
        </div>
        {me.effects.length > 0 && (
          <p className="flex max-w-[11rem] flex-wrap gap-1 pt-1">
            {me.effects.map((e: string) => (
              <span key={e} className="rounded bg-red-800/80 px-1">
                {t(`effect.${e}` as 'effect.wet')}
              </span>
            ))}
          </p>
        )}
      </div>
      {mobile && me.life !== 'dead' && (
        <div className="pointer-events-auto absolute bottom-[max(0.5rem,env(safe-area-inset-bottom))] left-[max(10.5rem,calc(env(safe-area-inset-left)+10rem))] sm:left-56">
          <Joystick />
        </div>
      )}

      {/* Bottom-right: thumb-zone actions */}
      <div className="pointer-events-auto absolute right-[max(0.5rem,env(safe-area-inset-right))] bottom-[max(0.5rem,env(safe-area-inset-bottom))] flex flex-col items-end gap-2">
        {promptLabel && (
          <Button
            size="lg"
            className="h-12 max-w-[60vw] truncate shadow-lg"
            onClick={() => interactWith(target)}
          >
            {promptLabel}{' '}
            {!mobile && <kbd className="ml-1 rounded bg-black/20 px-1 text-xs">E</kbd>}
          </Button>
        )}
        <div className="flex items-end gap-2">
          <div className="flex flex-col gap-2">
            <Button
              size="icon-lg"
              variant="secondary"
              aria-label={t('hud.bag')}
              onClick={() => useSession.getState().set({ panel: 'bag' })}
            >
              <Backpack aria-hidden />
            </Button>
            <Button
              size="icon-lg"
              variant="secondary"
              aria-label={t('hud.craft')}
              onClick={() => useSession.getState().set({ panel: 'craft' })}
            >
              <Hammer aria-hidden />
            </Button>
            <Button
              size="icon-lg"
              variant="secondary"
              aria-label={t('hud.map')}
              onClick={() => useSession.getState().set({ panel: 'map' })}
            >
              <MapIcon aria-hidden />
            </Button>
          </div>
          {mobile && (
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                aria-label={t('hud.sprint')}
                className={cn(
                  'grid size-16 place-items-center rounded-full border-2 border-white/40 bg-black/40 text-xs font-bold',
                  me.hingal && 'opacity-40',
                )}
                onPointerDown={() => inputActions.setSprint(true)}
                onPointerUp={() => inputActions.setSprint(false)}
                onPointerCancel={() => inputActions.setSprint(false)}
                onPointerLeave={() => inputActions.setSprint(false)}
              >
                <Wind aria-hidden />
              </button>
              <button
                type="button"
                aria-label={t('hud.attack')}
                className="grid size-16 place-items-center rounded-full border-2 border-white/40 bg-black/40"
                onPointerDown={() => inputActions.attack()}
              >
                <Axe aria-hidden />
              </button>
              <button
                type="button"
                aria-label={t('hud.jump')}
                className={cn(
                  'col-span-2 grid h-16 place-items-center rounded-full border-2 border-white/40 bg-black/40',
                  me.hingal && 'opacity-40',
                )}
                onPointerDown={() => inputActions.jump()}
              >
                <ArrowBigUp aria-hidden />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
