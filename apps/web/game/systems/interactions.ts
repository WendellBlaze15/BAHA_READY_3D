'use client';

import { create } from 'zustand';
import { live } from '../store/game-store';

export type Interactable = {
  id: string;
  kind: 'item' | 'task' | 'npc';
  key: string;
  label: string;
  x: number;
  z: number;
  radius?: number;
  enabled: () => boolean;
  onInteract: () => void;
};

const registry = new Map<string, Interactable>();

export function registerInteractable(i: Interactable) {
  registry.set(i.id, i);
  return () => {
    registry.delete(i.id);
  };
}

export function getInteractable(id: string) {
  return registry.get(id);
}

/** Nearest enabled interactable to the player, exposed to the HUD (changes rarely). */
export const useNearby = create<{
  nearby: { id: string; label: string; kind: Interactable['kind'] } | null;
}>(() => ({
  nearby: null,
}));

const REACH = 2.2;

export function updateNearby() {
  const p = live.player;
  let best: Interactable | null = null;
  let bestD = Infinity;
  for (const i of registry.values()) {
    if (!i.enabled()) continue;
    const d = Math.hypot(i.x - p.x, i.z - p.z);
    if (d < (i.radius ?? REACH) && d < bestD) {
      best = i;
      bestD = d;
    }
  }
  const cur = useNearby.getState().nearby;
  if ((best?.id ?? null) !== (cur?.id ?? null) || (best && cur && best.label !== cur.label)) {
    useNearby.setState({
      nearby: best ? { id: best.id, label: best.label, kind: best.kind } : null,
    });
  }
  return best;
}

export function distanceTo(id: string) {
  const i = registry.get(id);
  if (!i) return Infinity;
  return Math.hypot(i.x - live.player.x, i.z - live.player.z);
}

export function clearInteractables() {
  registry.clear();
  useNearby.setState({ nearby: null });
}
