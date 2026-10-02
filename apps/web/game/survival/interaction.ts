import { inRect, type SurvivalMap } from '@baha/shared/survival';

export const REACH_M = 2.5;
const REVIVE_M = 3;
const DOCK_REACH_M = 4;

export type Target =
  | { kind: 'loot'; id: string; x: number; z: number }
  | { kind: 'drop'; id: string; item: string; x: number; z: number }
  | { kind: 'npc'; id: string; x: number; z: number }
  | { kind: 'revive'; userId: string; name: string; x: number; z: number }
  | { kind: 'storage'; x: number; z: number }
  | { kind: 'boat'; x: number; z: number }
  | { kind: 'signal'; x: number; z: number }
  | { kind: 'sleep'; x: number; z: number };

export interface TargetWorld {
  map: SurvivalMap;
  me: { x: number; z: number; userId: string };
  lootOpened: Set<string>;
  crates: { id: string; x: number; z: number }[];
  drops: { id: string; item: string; x: number; z: number }[];
  npcs: { id: string; x: number; z: number; state: string }[];
  downed: { userId: string; name: string; x: number; z: number }[];
  shelterBuilt: boolean;
  night: boolean;
  finalDay: boolean;
}

const d = (a: { x: number; z: number }, b: { x: number; z: number }) =>
  Math.hypot(a.x - b.x, a.z - b.z);

/**
 * What the Interact button does right now: the nearest thing in reach, with helping a downed
 * teammate always first. Mirrors the server's range rules (it re-checks everything).
 */
export function nearestTarget(w: TargetWorld): Target | null {
  const me = w.me;
  const revive = w.downed
    .filter((p) => p.userId !== me.userId && d(p, me) <= REVIVE_M)
    .sort((a, b) => d(a, me) - d(b, me))[0];
  if (revive) return { kind: 'revive', ...revive };

  const cands: (Target & { dist: number })[] = [];
  const push = (t: Target) => {
    const dist = d(t, me);
    if (dist <= REACH_M) cands.push({ ...t, dist });
  };
  for (const l of w.map.lootPoints)
    if (!w.lootOpened.has(l.id)) push({ kind: 'loot', id: l.id, x: l.x, z: l.z });
  for (const c of w.crates)
    if (!w.lootOpened.has(c.id)) push({ kind: 'loot', id: c.id, x: c.x, z: c.z });
  for (const dr of w.drops) push({ kind: 'drop', id: dr.id, item: dr.item, x: dr.x, z: dr.z });
  for (const n of w.npcs)
    if (n.state === 'waiting') push({ kind: 'npc', id: n.id, x: n.x, z: n.z });
  push({ kind: 'storage', ...w.map.campStorage });
  if (w.finalDay) push({ kind: 'signal', x: w.map.signalSpot.x, z: w.map.signalSpot.z });
  cands.sort((a, b) => a.dist - b.dist);
  if (cands[0]) {
    const t: Partial<(typeof cands)[0]> = { ...cands[0] };
    delete t.dist;
    return t as Target;
  }
  const dock = w.map.boatDock;
  const reach = { ...dock, w: dock.w + 2 * DOCK_REACH_M, d: dock.d + 2 * DOCK_REACH_M };
  if (inRect(reach, me.x, me.z)) return { kind: 'boat', x: dock.x, z: dock.z };
  if (w.night && w.shelterBuilt && inRect(w.map.camp, me.x, me.z))
    return { kind: 'sleep', x: me.x, z: me.z };
  return null;
}
