'use client';

import { useTranslations } from 'next-intl';
import { BARANGAY_1, canCraft, scaledBoatMaterials, type Bag } from '@baha/shared/survival';
import { useRouter } from '@/i18n/navigation';
import { mapValues, useRoomState, useSession, type Panel } from '@/game/survival/session-store';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { useSurvivalText } from './use-text';

type Slot = { item: string; qty: number; durability: number };

function useMe() {
  const myId = useSession((s) => s.myId);
  return useRoomState((s) => {
    const me = myId ? s.players?.get?.(myId) : undefined;
    if (!me) return null;
    const bag: Slot[] = [];
    me.bag?.forEach?.((b: Slot) =>
      bag.push({ item: b.item, qty: b.qty, durability: b.durability }),
    );
    return {
      x: me.x as number,
      z: me.z as number,
      role: me.role as string,
      weight: me.weight as number,
      hand: me.hand as string,
      body: me.body as string,
      feet: me.feet as string,
      bag,
    };
  }, 4);
}

export function SurvivalPanels() {
  const t = useTranslations('survival');
  const panel = useSession((s) => s.panel);
  const close = () => useSession.getState().set({ panel: null });
  const titles: Record<Exclude<Panel, null>, string> = {
    bag: t('bag.title'),
    craft: t('craft.title'),
    storage: t('storage.title'),
    map: t('map.title'),
    boat: t('boat.title'),
    camp: t('boat.title'),
    menu: t('hud.menu'),
  };
  return (
    <Sheet open={panel !== null} onOpenChange={(o) => !o && close()}>
      <SheetContent side="right" className="z-[65] w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{panel ? titles[panel] : ''}</SheetTitle>
          <SheetDescription className="sr-only">{panel ? titles[panel] : ''}</SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-6">
          {panel === 'bag' && <BagPanel />}
          {panel === 'craft' && <CraftPanel />}
          {panel === 'storage' && <StoragePanel />}
          {panel === 'boat' && <BoatPanel />}
          {panel === 'map' && <MapPanel />}
          {panel === 'menu' && <MenuPanel />}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function BagPanel() {
  const t = useTranslations('survival');
  const { item, cfg, locale } = useSurvivalText();
  const room = useSession((s) => s.room)!;
  const me = useMe();
  const myId = useSession((s) => s.myId);
  const mates = useRoomState(
    (s) =>
      mapValues<{ username: string; life: string; x: number; z: number }>(s.players)
        .filter(([k, p]) => k !== myId && p.life === 'alive')
        .map(([k, p]) => ({ id: k, name: p.username, x: p.x, z: p.z })),
    2,
  );
  if (!me) return null;
  const near = (mates ?? []).filter((m) => Math.hypot(m.x - me.x, m.z - me.z) <= 3);
  const heavy = me.weight > cfg.bag.maxWeightKg * cfg.bag.slowAtRatio;
  return (
    <div className="space-y-3">
      <p className={cn('text-sm', heavy && 'font-semibold text-amber-600')}>
        {t('bag.weight', { weight: me.weight.toFixed(1), max: cfg.bag.maxWeightKg })}
      </p>
      {heavy && <p className="text-sm text-amber-700">{t('bag.heavy')}</p>}
      <ul className="grid grid-cols-1 gap-2">
        {me.bag.map((s, i) => {
          if (!s.item) return null;
          const def = cfg.items.find((x) => x.key === s.item);
          const equip = def?.use?.equip;
          const equipped = equip && [me.hand, me.body, me.feet].includes(s.item);
          return (
            <li key={i} className="bg-card min-w-0 rounded-lg border p-2">
              <p className="flex items-center justify-between gap-2 font-medium">
                <span className="min-w-0 truncate">
                  {s.qty}× {item(s.item)}
                </span>
                {equipped && <span className="text-primary text-xs">{t('bag.equipped')}</span>}
              </p>
              {def?.lesson && <p className="text-muted-foreground text-xs">{def.lesson[locale]}</p>}
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {def?.use && (
                  <Button
                    size="sm"
                    onClick={() => room.send(equip ? 'bag:equip' : 'useItem', { slot: i })}
                  >
                    {equip ? (equipped ? t('bag.unequip') : t('bag.equip')) : t('bag.use')}
                  </Button>
                )}
                {def?.category === 'medical' &&
                  near.map((m) => (
                    <Button
                      key={m.id}
                      size="sm"
                      variant="secondary"
                      onClick={() => room.send('useItem', { slot: i, targetUserId: m.id })}
                    >
                      {t('bag.use')} → {m.name}
                    </Button>
                  ))}
                {near.map((m) => (
                  <Button
                    key={`g${m.id}`}
                    size="sm"
                    variant="outline"
                    onClick={() => room.send('give:offer', { toUserId: m.id, slot: i })}
                  >
                    {t('bag.give', { name: m.name })}
                  </Button>
                ))}
                {s.qty > 1 && s.durability < 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => room.send('bag:split', { slot: i, qty: Math.floor(s.qty / 2) })}
                  >
                    {t('bag.split')}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => room.send('bag:drop', { slot: i, qty: s.qty })}
                >
                  {t('bag.drop')}
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
      {me.bag.every((s) => !s.item) && <p className="text-muted-foreground">{t('bag.empty')}</p>}
    </div>
  );
}

function toBag(slots: Slot[]): Bag {
  return slots.map((s) =>
    s.item
      ? { item: s.item, qty: s.qty, ...(s.durability >= 0 ? { durability: s.durability } : {}) }
      : null,
  );
}

function CraftPanel() {
  const t = useTranslations('survival');
  const { item, recipe, cfg, locale } = useSurvivalText();
  const room = useSession((s) => s.room)!;
  const me = useMe();
  const camp = useRoomState((s) => ({
    fireLit: !!s.camp?.fireLit,
    tier: s.camp?.workbenchTier as number,
    structures: String(s.camp?.structures ?? '').split(','),
  }));
  if (!me || !camp) return null;
  const atCamp =
    Math.abs(me.x - BARANGAY_1.camp.x) <= BARANGAY_1.camp.w / 2 &&
    Math.abs(me.z - BARANGAY_1.camp.z) <= BARANGAY_1.camp.d / 2;
  const sig = BARANGAY_1.signalSpot;
  const ctx = {
    atCamp,
    atSignalSpot: Math.hypot(me.x - sig.x, me.z - sig.z) <= sig.r,
    fireLit:
      camp.fireLit && Math.hypot(me.x - BARANGAY_1.campFire.x, me.z - BARANGAY_1.campFire.z) <= 8,
    workbenchTier: camp.tier ?? 1,
  };
  const bag = toBag(me.bag);
  return (
    <ul className="space-y-2">
      {cfg.recipes.map((r) => {
        const check = canCraft(r, bag, ctx);
        const built =
          r.structure && r.structure !== 'raft' && camp.structures.includes(r.structure);
        return (
          <li
            key={r.key}
            className={cn('bg-card rounded-lg border p-2', !check.ok && 'opacity-80')}
          >
            <p className="font-medium">{recipe(r.key)}</p>
            <p className="text-muted-foreground text-xs">
              {t('craft.needs')}: {r.inputs.map((i) => `${i.qty}× ${item(i.item)}`).join(', ')}
              {r.tools.length > 0 && ` · ${t('craft.tools')}: ${r.tools.map(item).join(', ')}`}
            </p>
            <p className="text-muted-foreground text-xs">
              {t(`craft.where.${r.where}`)}
              {r.needsFire && ` · ${t('craft.needsFire')}`}
            </p>
            {r.lesson && <p className="mt-1 text-xs">{r.lesson[locale]}</p>}
            <Button
              size="sm"
              className="mt-1.5"
              disabled={!check.ok || !!built}
              onClick={() => room.send('craft', { recipeKey: r.key })}
            >
              {built ? t('craft.built') : t('craft.craft')}
            </Button>
            {!check.ok && (
              <span className="text-muted-foreground ml-2 text-xs">
                {t(`denied.${check.reason}` as 'denied.not_here')}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function StoragePanel() {
  const t = useTranslations('survival');
  const { item } = useSurvivalText();
  const room = useSession((s) => s.room)!;
  const me = useMe();
  const storage = useRoomState((s) => mapValues<number>(s.storage), 4);
  if (!me) return null;
  const atCamp =
    Math.abs(me.x - BARANGAY_1.camp.x) <= BARANGAY_1.camp.w / 2 &&
    Math.abs(me.z - BARANGAY_1.camp.z) <= BARANGAY_1.camp.d / 2;
  if (!atCamp) return <p>{t('storage.onlyAtCamp')}</p>;
  const mine = new Map<string, number>();
  for (const s of me.bag) if (s.item) mine.set(s.item, (mine.get(s.item) ?? 0) + s.qty);
  return (
    <div className="space-y-4">
      <section>
        <h3 className="mb-2 font-semibold">{t('bag.title')}</h3>
        <ul className="space-y-1.5">
          {[...mine].map(([k, q]) => (
            <li key={k} className="flex items-center justify-between gap-2 text-sm">
              <span className="min-w-0 truncate">
                {q}× {item(k)}
              </span>
              <Button
                size="xs"
                onClick={() => room.send('storage:deposit', { itemKey: k, qty: q })}
              >
                {t('storage.deposit')}
              </Button>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h3 className="mb-2 font-semibold">{t('storage.title')}</h3>
        {storage?.length ? (
          <ul className="space-y-1.5">
            {storage.map(([k, q]) => (
              <li key={k} className="flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0 truncate">
                  {q}× {item(k)}
                </span>
                <span className="flex gap-1">
                  <Button
                    size="xs"
                    variant="secondary"
                    onClick={() => room.send('storage:withdraw', { itemKey: k, qty: 1 })}
                  >
                    1
                  </Button>
                  <Button
                    size="xs"
                    variant="secondary"
                    onClick={() => room.send('storage:withdraw', { itemKey: k, qty: q })}
                  >
                    {t('storage.withdraw')}
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">{t('storage.empty')}</p>
        )}
      </section>
    </div>
  );
}

function BoatPanel() {
  const t = useTranslations('survival');
  const { item, cfg, locale } = useSurvivalText();
  const room = useSession((s) => s.room)!;
  const v = useRoomState((s) => ({
    stage: s.boat?.stage as number,
    progress: s.boat?.progress as number,
    deposited: Object.fromEntries(mapValues<number>(s.boat?.deposited)),
    players: (s.players?.size as number) ?? 1,
    difficulty: s.difficulty as 'easy' | 'normal' | 'hard',
    tier: s.camp?.workbenchTier as number,
    campLevel: s.camp?.level as number,
    campProgress: s.camp?.upgradeProgress as number,
    campDeposited: Object.fromEntries(mapValues<number>(s.camp?.upgradeDeposited)),
    heli: s.heli as string,
  }));
  if (!v) return null;
  const stage = cfg.boatStages[v.stage];
  const needs = stage
    ? scaledBoatMaterials(stage, cfg.difficulties[v.difficulty], v.players, cfg.session)
    : [];
  const up = cfg.campUpgrades[(v.campLevel ?? 1) - 1];
  const send = (target: 'boat' | 'camp', action: 'deposit' | 'work') =>
    room.send('build', { target, action });
  return (
    <div className="space-y-5">
      <section className="space-y-2">
        {stage ? (
          <>
            <h3 className="font-semibold">
              {t('boat.stage', { stage: stage.stage, name: stage.name[locale] })}
            </h3>
            <div className="h-2 overflow-hidden rounded-full bg-black/10">
              <div
                className="h-full bg-sky-500"
                style={{ width: `${Math.round((v.progress ?? 0) * 100)}%` }}
              />
            </div>
            <ul className="text-sm">
              {needs.map((m) => (
                <li key={m.item}>
                  {item(m.item)}: {Math.min(v.deposited[m.item] ?? 0, m.qty)}/{m.qty}
                </li>
              ))}
            </ul>
            {stage.tools.length > 0 && (
              <p className="text-muted-foreground text-xs">
                {t('boat.tools')}: {stage.tools.map(item).join(', ')}
              </p>
            )}
            {stage.workbench2 && (v.tier ?? 1) < 2 && (
              <p className="text-xs text-amber-700">{t('boat.workbench')}</p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => send('boat', 'deposit')}>{t('boat.deposit')}</Button>
              <Button variant="secondary" onClick={() => send('boat', 'work')}>
                {t('boat.work')}
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="font-semibold">{t('boat.done')}</p>
            {v.heli !== 'none' && (
              <Button onClick={() => room.send('interact', { targetId: 'boat' })}>
                {t('hud.prompt.boat')}
              </Button>
            )}
          </>
        )}
      </section>
      {up && (
        <section className="space-y-2 border-t pt-4">
          <h3 className="font-semibold">{t('boat.camp', { level: up.level })}</h3>
          <div className="h-2 overflow-hidden rounded-full bg-black/10">
            <div
              className="h-full bg-amber-500"
              style={{ width: `${Math.round((v.campProgress ?? 0) * 100)}%` }}
            />
          </div>
          <ul className="text-sm">
            {up.materials.map((m) => (
              <li key={m.item}>
                {item(m.item)}: {Math.min(v.campDeposited[m.item] ?? 0, m.qty)}/{m.qty}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => send('camp', 'deposit')}>{t('boat.deposit')}</Button>
            <Button variant="secondary" onClick={() => send('camp', 'work')}>
              {t('boat.work')}
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}

/** 2D map (SVG): zones, camp, rescue/signal points, danger zones, teammates, crates, survivors. */
function MapPanel() {
  const t = useTranslations('survival');
  const myId = useSession((s) => s.myId);
  const pings = useSession((s) => s.pings);
  const v = useRoomState(
    (s) => ({
      players: mapValues<{ x: number; z: number; username: string; life: string }>(s.players).map(
        ([k, p]) => ({ id: k, x: p.x, z: p.z, name: p.username, life: p.life }),
      ),
      crates: mapValues<{ x: number; z: number }>(s.crates).map(([k, c]) => ({
        id: k,
        x: c.x,
        z: c.z,
      })),
      npcs: mapValues<{ x: number; z: number; state: string }>(s.npcs)
        .filter(([, n]) => n.state === 'waiting' || n.state === 'following')
        .map(([k, n]) => ({ id: k, x: n.x, z: n.z })),
    }),
    2,
  );
  const m = BARANGAY_1;
  const S = m.halfSize;
  return (
    <figure>
      <svg
        viewBox={`${-S} ${-S} ${S * 2} ${S * 2}`}
        className="w-full rounded-lg bg-[#3e5c76]"
        role="img"
        aria-label={t('map.title')}
      >
        {m.zones.map((z) => (
          <rect
            key={z.key}
            x={z.rect.x - z.rect.w / 2}
            y={z.rect.z - z.rect.d / 2}
            width={z.rect.w}
            height={z.rect.d}
            fill="#5b4a36"
            opacity={0.35}
          />
        ))}
        {m.platforms.map((p) => (
          <rect
            key={p.id}
            x={p.x - p.w / 2}
            y={p.z - p.d / 2}
            width={p.w}
            height={p.d}
            fill="#c98b5a"
          />
        ))}
        {m.hazards.map((h) => (
          <rect
            key={h.id}
            x={h.rect.x - h.rect.w / 2}
            y={h.rect.z - h.rect.d / 2}
            width={h.rect.w}
            height={h.rect.d}
            fill="#e53935"
            opacity={0.3}
          >
            <title>{t('map.danger')}</title>
          </rect>
        ))}
        <rect
          x={m.camp.x - m.camp.w / 2}
          y={m.camp.z - m.camp.d / 2}
          width={m.camp.w}
          height={m.camp.d}
          fill="none"
          stroke="#ffd54f"
          strokeWidth={1.5}
        />
        <circle
          cx={m.rescuePoint.x}
          cy={m.rescuePoint.z}
          r={m.rescuePoint.r}
          fill="#43a047"
          opacity={0.6}
        />
        <circle
          cx={m.signalSpot.x}
          cy={m.signalSpot.z}
          r={m.signalSpot.r}
          fill="#ff7043"
          opacity={0.7}
        />
        {v?.crates.map((c) => (
          <rect key={c.id} x={c.x - 2} y={c.z - 2} width={4} height={4} fill="#ff9800" />
        ))}
        {v?.npcs.map((n) => (
          <circle key={n.id} cx={n.x} cy={n.z} r={2.5} fill="#ffffff" />
        ))}
        {pings
          .filter((p) => p.until > Date.now())
          .map((p) => (
            <circle key={`${p.userId}${p.until}`} cx={p.x} cy={p.z} r={3} fill="#1e88e5" />
          ))}
        {v?.players.map((p) => (
          <circle
            key={p.id}
            cx={p.x}
            cy={p.z}
            r={p.id === myId ? 3.5 : 2.5}
            fill={p.id === myId ? '#00e5ff' : p.life === 'downed' ? '#e53935' : '#fafafa'}
            stroke="#000"
            strokeWidth={0.6}
          >
            <title>{p.id === myId ? t('map.you') : p.name}</title>
          </circle>
        ))}
      </svg>
      <figcaption className="text-muted-foreground mt-2 flex flex-wrap gap-3 text-xs">
        <span>🟦 {t('map.you')}</span>
        <span>🟨 {t('map.camp')}</span>
        <span>🟩 {t('map.rescue')}</span>
        <span>🟧 {t('map.signal')}</span>
        <span>🟥 {t('map.danger')}</span>
      </figcaption>
    </figure>
  );
}

function MenuPanel() {
  const t = useTranslations('survival');
  const router = useRouter();
  const room = useSession((s) => s.room)!;
  const myId = useSession((s) => s.myId);
  const v = useRoomState((s) => {
    const me = myId ? s.players?.get?.(myId) : undefined;
    return {
      solo: s.mode === 'solo',
      me: me ? { x: me.x as number, y: me.y as number, z: me.z as number } : null,
      mates: mapValues<{ username: string }>(s.players)
        .filter(([k]) => k !== myId)
        .map(([k, p]) => ({ id: k, name: p.username })),
    };
  });
  if (!v) return null;
  const close = () => useSession.getState().set({ panel: null });
  return (
    <div className="space-y-5">
      {v.solo && (
        <Button
          className="w-full"
          onClick={() => {
            room.send('pause', { paused: true });
            close();
          }}
        >
          {t('hud.pause')}
        </Button>
      )}
      <section>
        <h3 className="mb-2 font-semibold">
          {t('emote.wave')} · {t('ping.go')}
        </h3>
        <div className="flex flex-wrap gap-1.5">
          {(['wave', 'thumbs_up', 'dance', 'point', 'cry', 'celebrate'] as const).map((e) => (
            <Button
              key={e}
              size="sm"
              variant="outline"
              onClick={() => room.send('emote', { id: e })}
            >
              {t(`emote.${e}`)}
            </Button>
          ))}
        </div>
        {v.me && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {(['item', 'danger', 'go', 'help'] as const).map((p) => (
              <Button
                key={p}
                size="sm"
                variant="secondary"
                onClick={() => room.send('ping', { type: p, ...v.me! })}
              >
                {t(`ping.${p}`)}
              </Button>
            ))}
          </div>
        )}
      </section>
      {!v.solo && (
        <section className="space-y-1.5">
          <Button
            variant="outline"
            className="w-full"
            onClick={() => room.send('vote', { type: 'rest', value: true })}
          >
            {t('vote.rest')}
          </Button>
          {v.mates.map((m) => (
            <Button
              key={m.id}
              variant="outline"
              className="w-full"
              onClick={() => room.send('vote', { type: 'kick', targetUserId: m.id, value: true })}
            >
              {t('vote.kick', { name: m.name })}
            </Button>
          ))}
          <Button
            variant="outline"
            className="w-full"
            onClick={() => room.send('vote', { type: 'abandon', value: true })}
          >
            {t('vote.abandon')}
          </Button>
        </section>
      )}
      <Button
        variant="destructive"
        className="w-full"
        onClick={() => {
          void room.leave(true);
          router.push('/survival');
        }}
      >
        {t('hud.leaveSession')}
      </Button>
    </div>
  );
}
