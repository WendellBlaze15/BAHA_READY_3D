import type { Simulation } from '../sim/simulation.ts';
import type { SimPlayer } from '../sim/types.ts';
import { BagSlot, DropState, type PlayerState, type SurvivalState } from './state.ts';

const r8 = (v: number) => Math.round(Math.max(0, Math.min(100, v)));

/**
 * Mirrors the simulation into the synced Colyseus state. Primitive assignments of an
 * unchanged value don't produce patches, so per-player fields are copied every tick; maps
 * (loot, drops, storage…) only when the simulation marked them dirty.
 */
export function syncWorld(state: SurvivalState, sim: Simulation, full = false) {
  state.simTime = sim.time;
  state.day = sim.clock.day;
  state.minute = sim.clock.minute;
  state.dayPhase = sim.dayPhase;
  state.weather = sim.weather;
  state.waterLevel = sim.waterLevel;
  state.paused = sim.paused;

  const d = sim.takeDirty();
  for (const p of sim.players.values()) {
    const ps = state.players.get(p.userId);
    if (ps) syncPlayer(ps, p, sim, full || d.bags.has(p.userId));
  }

  if (full) for (const id of sim.lootOpened) d.loot.add(id);
  for (const id of d.loot) state.lootOpened.set(id, true);

  if (full) for (const id of sim.chopsLeft.keys()) d.chops.add(id);
  for (const id of d.chops) state.chops.set(id, sim.chopsLeft.get(id) ?? 0);

  if (full || d.drops) {
    for (const id of state.drops.keys()) if (!sim.drops.has(id)) state.drops.delete(id);
    for (const [id, dr] of sim.drops) {
      let ds = state.drops.get(id);
      if (!ds) {
        ds = new DropState();
        state.drops.set(id, ds);
      }
      ds.item = dr.item;
      ds.qty = dr.qty;
      ds.x = dr.x;
      ds.z = dr.z;
    }
  }

  if (full || d.storage) {
    for (const k of state.storage.keys()) if (!sim.storage.has(k)) state.storage.delete(k);
    for (const [k, q] of sim.storage) state.storage.set(k, q);
  }

  if (full || d.camp) {
    state.camp.level = sim.camp.level;
    state.camp.workbenchTier = sim.camp.workbenchTier;
    state.camp.structures = [...sim.camp.structures].sort().join(',');
  }
  state.camp.fireLit = sim.fireLit();
}

function syncPlayer(ps: PlayerState, p: SimPlayer, sim: Simulation, bag: boolean) {
  ps.x = p.x;
  ps.y = p.y;
  ps.z = p.z;
  ps.rotY = p.rotY;
  ps.anim = p.anim;
  ps.life = p.life;
  ps.health = r8(p.stats.health);
  ps.hunger = r8(p.stats.hunger);
  ps.thirst = r8(p.stats.thirst);
  ps.warmth = r8(p.stats.warmth);
  ps.energy = r8(p.stats.energy);
  ps.stamina = r8(p.sprint.stamina);
  ps.hingal = p.sprint.exhausted;
  ps.sprinting = p.sprint.sprinting;
  ps.effects = [...p.stats.effects].sort().join(',');
  ps.hand = p.equip.hand ?? '';
  ps.body = p.equip.body ?? '';
  ps.feet = p.equip.feet ?? '';
  ps.channel = p.channel?.kind ?? '';
  ps.channelEndsAt = p.channel?.endsAt ?? 0;
  if (!bag) return;
  ps.weight = sim.bagWeightOf(p);
  ps.slotsUsed = p.bag.filter(Boolean).length;
  // Fixed-length array: one entry per bag slot (empty slots have item '').
  while (ps.bag.length < p.bag.length) ps.bag.push(new BagSlot());
  while (ps.bag.length > p.bag.length) ps.bag.pop();
  p.bag.forEach((s, i) => {
    const b = ps.bag[i]!;
    b.item = s?.item ?? '';
    b.qty = s?.qty ?? 0;
    b.durability = s?.durability ?? -1;
  });
}
