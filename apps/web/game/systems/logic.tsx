'use client';

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { HAZARD_DAMAGE, DEFAULT_HAZARD_DAMAGE } from '@baha/shared/game';
import { depthBand, live, useGame } from '../store/game-store';
import { audio, haptic } from './audio';
import { consumeInteract, consumePause } from './input';
import { getInteractable, updateNearby } from './interactions';
import { npcRuntime, stepFollowers } from './npcs';

export type Msg = (key: string, values?: Record<string, string | number>) => string;

const UI_HZ = 0.25;
const POS_SAMPLE = 0.5;

/** Shared per-frame housekeeping: clock, pause key, interact key, HUD sync. */
function useCommon(msg: Msg) {
  const uiAcc = useRef(0);
  const nearbyAcc = useRef(0);
  return (dt: number) => {
    const g = useGame.getState();
    if (consumePause() && (g.phase === 'prep' || g.phase === 'evac')) g.setPaused(!g.paused);
    if (g.paused || (g.phase !== 'prep' && g.phase !== 'evac')) return false;

    live.time += dt;

    nearbyAcc.current += dt;
    if (nearbyAcc.current > 0.1) {
      nearbyAcc.current = 0;
      updateNearby();
    }
    if (consumeInteract()) {
      const best = updateNearby();
      if (best) best.onInteract();
    }

    // Announcements (radio/TV bulletins) at scheduled times.
    const anns = g.config?.announcements ?? [];
    anns.forEach((a, i) => {
      const done = g.events.some((e) => e.type === 'announcement' && e.payload.index === i);
      if (!done && live.time >= a.atSec) {
        g.log({ type: 'announcement', payload: { index: i } });
        g.announce(msg(`__ann__${i}`));
        audio.siren(2);
      }
    });

    uiAcc.current += dt;
    if (uiAcc.current >= UI_HZ) {
      uiAcc.current = 0;
      useGame.setState({
        timeUi: live.time,
        healthUi: Math.round(live.health),
        staminaUi: Math.round(live.stamina),
        depthUi: depthBand(live.depth),
      });
    }
    return true;
  };
}

/** Prep phase: timer only (actions happen through interactables). */
export function PrepLogic({ msg }: { msg: Msg }) {
  const common = useCommon(msg);
  const warned = useRef(false);
  useFrame((_, raw) => {
    const dt = Math.min(raw, 0.1);
    if (!common(dt)) return;
    const g = useGame.getState();
    if (g.prepEndsAt !== null) {
      const left = g.prepEndsAt - live.time;
      if (left <= 15 && !warned.current) {
        warned.current = true;
        g.showHint(msg('prepEndingSoon'), 'warn', true);
      }
      if (left <= 0) {
        g.showHint(msg('prepTimeUp'), 'warn', true);
        g.setPhase('evac');
      }
    }
  });
  return null;
}

/** Evacuation phase: water, vitals, hazards, NPCs, goal, sampling. */
export function EvacLogic({ msg }: { msg: Msg }) {
  const common = useCommon(msg);
  const lastSample = useRef(-1);
  const nextFlash = useRef(8);
  const inCurrent = useRef<string | null>(null);

  useFrame((_, raw) => {
    const dt = Math.min(raw, 0.1);
    // Lightning flash decays even while paused so the scene doesn't freeze bright.
    live.lightningFlash = Math.max(0, live.lightningFlash - raw * 3);
    if (!common(dt)) return;
    const g = useGame.getState();
    const cfg = g.config!;
    const layout = g.layout!;
    const texts = g.texts;
    const started = g.evacStartedAt ?? 0;
    const elapsed = live.time - started;
    const p = live.player;

    // Rising water (flat town; the evacuation center pad is high ground).
    live.waterY = Math.min(
      1.9,
      0.06 + cfg.waterRiseSpeed * elapsed * (1 + elapsed / (cfg.evacTimeSec * 2)),
    );
    const dEvac = Math.hypot(p.x - layout.evac.center.x, p.z - layout.evac.center.z);
    live.depth = dEvac < layout.evac.radius ? 0 : live.waterY;
    const band = depthBand(live.depth);

    // Position samples (anti-cheat replay).
    if (live.time - lastSample.current >= POS_SAMPLE) {
      lastSample.current = live.time;
      g.log({
        type: 'pos',
        payload: { x: Math.round(p.x * 100) / 100, z: Math.round(p.z * 100) / 100 },
      });
    }

    // Vitals.
    const wetPenalty = g.packed.includes('clothes') ? 1 : 1.5;
    if (band === 'chest') {
      live.health -= 6 * dt;
      if (Math.random() < dt * 0.3) g.showHint(msg('chestDeep'), 'danger');
    }
    const moving = live.speed > 0.5;
    if ((band === 'waist' || band === 'chest') && moving) live.stamina -= 4 * dt * wetPenalty;
    else if (band === 'knee' && moving) live.stamina -= 1.5 * dt * wetPenalty;
    else live.stamina += 5 * dt;

    // Hazards.
    let currentHere: string | null = null;
    for (const h of layout.hazards) {
      const d = Math.hypot(p.x - h.pos.x, p.z - h.pos.z);
      if (h.key === 'strong_current' && d < h.radius) {
        currentHere = h.id;
        live.stamina -= 8 * dt;
      }
      if (g.hazardsHit.includes(h.id)) continue;
      let triggered = false;
      if (h.key === 'lightning_exposure') triggered = d < h.radius && live.lightningFlash > 0.9;
      else if (h.key === 'open_manhole') triggered = d < h.radius && live.depth > 0.12;
      else triggered = d < h.radius;
      if (!triggered) continue;

      g.hitHazard(h.id, h.key);
      live.health -= HAZARD_DAMAGE[h.key] ?? DEFAULT_HAZARD_DAMAGE;
      haptic([60, 40, 120]);
      audio.blip('hit');
      const tx = texts.hazards[h.key];
      g.showHint(tx ? `${tx.name}: ${tx.explanation}` : msg('hazardHit'), 'danger', true);
      if (h.key === 'live_wire') {
        g.end('instant_fail', h.key);
        return;
      }
    }
    if (currentHere && inCurrent.current !== currentHere && !g.hazardsHit.includes(currentHere)) {
      g.showHint(msg('currentWarning'), 'warn', true);
    }
    inCurrent.current = currentHere;

    live.stamina = Math.max(0, Math.min(100, live.stamina));
    if (live.health <= 0) {
      live.health = 0;
      g.end('health');
      return;
    }

    // Lightning (seeded feel, not replayed: exposure is validated by zone + event).
    if (cfg.lightning) {
      nextFlash.current -= dt;
      if (nextFlash.current <= 0) {
        nextFlash.current = 9 + Math.random() * 10;
        live.lightningFlash = 1.2;
        audio.thunder(Math.random() * 0.8);
      }
    }

    // NPCs.
    stepFollowers(p, g.followers, 4.2, dt);

    // Goal.
    if (dEvac < layout.evac.radius) {
      for (const id of g.followers) {
        const r = npcRuntime.get(id);
        if (r) r.state = 'rescued';
      }
      audio.blip('win');
      g.end('evac');
      return;
    }
    if (g.evacEndsAt !== null && live.time >= g.evacEndsAt) g.end('timeout');
  });
  return null;
}

/** Current push used by the Player controller. */
export function currentForce(): { x: number; z: number } {
  const g = useGame.getState();
  const layout = g.layout;
  if (!layout || g.phase !== 'evac') return { x: 0, z: 0 };
  for (const h of layout.hazards) {
    if (h.key !== 'strong_current' || !h.dir) continue;
    const d = Math.hypot(live.player.x - h.pos.x, live.player.z - h.pos.z);
    if (d < h.radius) {
      const s = 2.2 * (g.config?.currentStrength ?? 0.5);
      return { x: h.dir.x * s, z: h.dir.z * s };
    }
  }
  return { x: 0, z: 0 };
}

export { getInteractable };
